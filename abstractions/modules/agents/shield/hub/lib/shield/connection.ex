defmodule Shield.Connection do
  use GenServer
  alias Shield.Protocol, as: P
  def start(socket), do: GenServer.start(__MODULE__, socket)

  def init(socket) do
    counter = :atomics.new(2, [])
    reader = self()
    writer = spawn_link(fn -> write_loop(socket, counter, reader) end)

    {:ok,
     %{
       socket: socket,
       ref: %{pid: reader, writer: writer, counter: counter},
       buffer: P.buffer(),
       pending: MapSet.new()
     }}
  end

  def deliver(ref, record) do
    frame = P.encode(record)
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
    do: {:noreply, %{s | pending: MapSet.delete(s.pending, id)}}

  def handle_info({:tcp_closed, _}, s), do: {:stop, :normal, s}
  def handle_info({:tcp_error, _, _}, s), do: {:stop, :normal, s}
  def handle_info(:overflow, s), do: {:stop, :normal, s}

  def handle_info({:agent_failed, id, _}, s) do
    deliver(
      s.ref,
      Map.merge(P.envelope("agent_failed", id), %{"error" => %{"code" => "state_owner_failed"}})
    )

    send(s.ref.writer, :close)
    {:noreply, s}
  end

  defp request(r, s) do
    cond do
      not P.valid?(r) ->
        deliver(s.ref, P.error(r["id"], r["agent-id"], nil, "invalid_protocol"))
        s

      MapSet.member?(s.pending, r["id"]) ->
        send(self(), :overflow)
        s

      MapSet.size(s.pending) >= 64 ->
        deliver(s.ref, P.error(r["id"], r["agent-id"], r["engine"], "request_limit"))
        s

      true ->
        GenServer.cast(Shield.Manager, {:request, s.ref, r})
        %{s | pending: MapSet.put(s.pending, r["id"])}
    end
  end

  def terminate(_, s) do
    GenServer.cast(Shield.Manager, {:disconnect, self()})
    :gen_tcp.close(s.socket)
    Process.exit(s.ref.writer, :shutdown)
  end
end
