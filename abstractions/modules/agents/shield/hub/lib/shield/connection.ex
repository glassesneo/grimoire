defmodule Shield.Connection do
  use GenServer
  alias Shield.Protocol, as: P
  def start(socket), do: GenServer.start(__MODULE__, socket)

  def init(socket) do
    counter = :atomics.new(2, [])
    reader = self()
    writer = spawn_link(fn -> write_loop(socket, counter, reader) end)

    # The id names this connection to engines, which use it to tell writers apart.
    id = "c" <> Integer.to_string(System.unique_integer([:positive, :monotonic]))

    {:ok,
     %{
       socket: socket,
       ref: %{pid: reader, id: id, writer: writer, counter: counter},
       buffer: P.buffer(),
       # Unresolved request ids, each with the agent that answers it once one is known.
       pending: %{}
     }}
  end

  def deliver(ref, record), do: deliver_frame(ref, P.encode(record), record)

  @doc "Delivers a record already encoded as `frame`, so one encoding serves every subscriber."
  def deliver_frame(ref, frame, record) do
    index = if record["type"] == "snapshot", do: 2, else: 1
    limit = if index == 2, do: P.record_limit(), else: P.live_limit()
    count = :atomics.add_get(ref.counter, index, byte_size(frame))

    if byte_size(frame) > P.record_limit() or count > limit do
      :atomics.sub(ref.counter, index, byte_size(frame))
      send(ref.pid, :overflow)
    else
      send(ref.writer, {:frame, frame, index})
    end

    if record["type"] == "response", do: send(ref.pid, {:finished, record["id"]})
    :ok
  end

  defp write_loop(socket, counter, reader) do
    receive do
      {:frame, frame, index} ->
        result = :gen_tcp.send(socket, frame)
        :atomics.sub(counter, index, byte_size(frame))

        case result do
          :ok -> write_loop(socket, counter, reader)
          _ -> send(reader, :overflow)
        end

      :close ->
        :gen_tcp.close(socket)
        send(reader, :overflow)
    end
  end

  def handle_info(:activate, s) do
    :inet.setopts(s.socket, active: :once)
    {:noreply, s}
  end

  def handle_info({:tcp, _, bytes}, s) do
    try do
      {records, buffer} = P.feed(s.buffer, bytes)
      s = Enum.reduce(records, %{s | buffer: buffer}, &request/2)
      :inet.setopts(s.socket, active: :once)
      {:noreply, s}
    rescue
      _ -> {:stop, :normal, s}
    end
  end

  def handle_info({:finished, id}, s),
    do: {:noreply, %{s | pending: Map.delete(s.pending, id)}}

  def handle_info({:routed, id, agent}, s) do
    if Map.has_key?(s.pending, id),
      do: {:noreply, %{s | pending: Map.put(s.pending, id, agent)}},
      else: {:noreply, s}
  end

  def handle_info({:tcp_closed, _}, s), do: {:stop, :normal, s}
  def handle_info({:tcp_error, _, _}, s), do: {:stop, :normal, s}
  def handle_info(:overflow, s), do: {:stop, :normal, s}

  # The crashed Agent can no longer answer, so its requests are answered here; the
  # connection stays open for its other agents.
  def handle_info({:agent_failed, id, _}, s) do
    deliver(
      s.ref,
      Map.merge(P.envelope("agent_failed", id), %{"error" => %{"code" => "state_owner_failed"}})
    )

    for {request, ^id} <- s.pending,
        do: deliver(s.ref, P.error(request, id, nil, "state_owner_failed"))

    {:noreply, s}
  end

  defp request(r, s) do
    cond do
      not P.valid?(r) ->
        deliver(s.ref, P.error(r["id"], r["agent-id"], nil, "invalid_protocol"))
        s

      Map.has_key?(s.pending, r["id"]) ->
        send(self(), :overflow)
        s

      map_size(s.pending) >= 64 ->
        deliver(s.ref, P.error(r["id"], r["agent-id"], r["engine"], "request_limit"))
        s

      true ->
        GenServer.cast(Shield.Manager, {:request, s.ref, r})

        agent =
          if r["type"] == "engine_request" or r["method"] == "take_write",
            do: r["agent-id"]

        %{s | pending: Map.put(s.pending, r["id"], agent)}
    end
  end

  def terminate(_, s) do
    GenServer.cast(Shield.Manager, {:disconnect, self()})
    :gen_tcp.close(s.socket)
    Process.exit(s.ref.writer, :shutdown)
  end
end
