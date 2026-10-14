defmodule Shield.Agent do
  use GenServer
  alias Shield.{Pi, Protocol, Connection}

  def child_spec(args),
    do: %{id: __MODULE__, start: {__MODULE__, :start_link, [args]}, restart: :temporary}

  def start_link({info, launch}),
    do:
      GenServer.start_link(__MODULE__, {info, launch},
        name: {:via, Registry, {Shield.Registry, info.id}}
      )

  def init({info, launch}) do
    Process.flag(:trap_exit, true)
    d = launch.descriptor
    env = d["env"]

    port =
      Port.open({:spawn_executable, String.to_charlist(d["executable"])}, [
        :binary,
        :exit_status,
        :use_stdio,
        :hide,
        {:args, Enum.map(d["argv"], &String.to_charlist/1)},
        {:cd, String.to_charlist(launch.cwd)},
        {:env,
         Enum.map(env, fn {k, v} ->
           {String.to_charlist(k), if(v == false, do: false, else: String.to_charlist(v))}
         end)}
      ])

    {:os_pid, os_pid} = Port.info(port, :os_pid)
    {engine, effects} = Pi.init(launch)

    s = %{
      info: info,
      engine: engine,
      port: port,
      os_pid: os_pid,
      seq: 0,
      subscribers: %{},
      clients: %{},
      buffer: "",
      state: "starting",
      stopping: false,
      failure: nil
    }

    Process.send_after(self(), :startup_timeout, 60_000)
    Process.send_after(self(), :tick, 100)
    {:ok, effects(s, effects)}
  end

  def handle_cast({:attach, ref, r, options}, s) do
    if s.state in ["starting", "ready"] do
      s = watch(s, ref)
      {engine, next} = Pi.attach(s.engine, ref, r, options)
      {:noreply, effects(%{s | engine: engine}, next)}
    else
      Connection.deliver(ref, Protocol.error(r["id"], s.info.id, "agent_unavailable"))
      {:noreply, s}
    end
  end

  def handle_cast({:input, ref, r}, s) do
    if s.state == "ready" do
      s = watch(s, ref)
      {engine, next} = Pi.input(s.engine, ref, r, now())
      {:noreply, effects(%{s | engine: engine}, next)}
    else
      Connection.deliver(ref, Protocol.error(r["id"], s.info.id, "agent_unavailable"))
      {:noreply, s}
    end
  end

  def handle_cast(:stop, s), do: {:noreply, stop(s)}

  def handle_info({port, {:data, bytes}}, %{port: port} = s) do
    try do
      {records, buffer} = Protocol.feed(s.buffer, bytes)

      s =
        Enum.reduce(records, %{s | buffer: buffer}, fn r, s ->
          if s.failure do
            s
          else
            {engine, next} = Pi.output(s.engine, r, now())
            effects(%{s | engine: engine}, next)
          end
        end)

      {:noreply, s}
    rescue
      _ -> {:noreply, fail(s, "invalid_pi_frame")}
    end
  end

  def handle_info({port, {:exit_status, code}}, %{port: port} = s) do
    {engine, pending} = Pi.failed(s.engine)
    state = if s.stopping and is_nil(s.failure) and code in [0, 143], do: "exited", else: "failed"
    s = effects(%{s | port: nil, os_pid: nil, engine: engine}, pending)
    {:noreply, lifecycle(s, state, %{"exitCode" => code})}
  end

  def handle_info({:EXIT, port, _}, %{port: port} = s), do: {:noreply, s}
  def handle_info({:EXIT, _, _}, s), do: {:noreply, s}

  def handle_info(:startup_timeout, %{state: "starting"} = s),
    do: {:noreply, fail(s, "pi_start_timeout")}

  def handle_info(:startup_timeout, s), do: {:noreply, s}

  def handle_info({:kill, pid}, %{os_pid: pid, port: port} = s) when not is_nil(port) do
    signal(pid, "KILL")
    Process.send_after(self(), {:kill_timeout, pid}, 1000)
    {:noreply, %{s | failure: s.failure || "forced_kill"}}
  end

  def handle_info({:kill, _}, s), do: {:noreply, s}

  def handle_info({:kill_timeout, pid}, %{os_pid: pid, port: port} = s) when not is_nil(port) do
    if Port.info(port), do: Port.close(port)
    {engine, pending} = Pi.failed(s.engine)

    {:noreply,
     effects(%{s | engine: engine, port: nil, os_pid: nil}, pending)
     |> lifecycle("failed", %{"error" => "exit_not_observed"})}
  end

  def handle_info({:kill_timeout, _}, s), do: {:noreply, s}

  def handle_info(:tick, s) do
    {engine, next} = Pi.expire(s.engine, now())
    Process.send_after(self(), :tick, 100)
    {:noreply, effects(%{s | engine: engine}, next)}
  end

  def handle_info({:DOWN, monitor, :process, pid, _}, s) do
    {:noreply,
     %{
       s
       | engine: Pi.detach(s.engine, pid),
         clients: Map.delete(s.clients, pid),
         subscribers: Map.reject(s.subscribers, fn {_, {_, m}} -> m == monitor end)
     }}
  end

  defp watch(s, ref) do
    if Map.has_key?(s.clients, ref.pid),
      do: s,
      else: %{s | clients: Map.put(s.clients, ref.pid, Process.monitor(ref.pid))}
  end

  defp effects(s, next) do
    Enum.reduce_while(next, s, fn e, before ->
      after_effect = effect(e, before)

      if is_nil(before.failure) and not is_nil(after_effect.failure),
        do: {:halt, after_effect},
        else: {:cont, after_effect}
    end)
  end

  defp effect({:write, r}, s) do
    frame = Protocol.encode(r)

    cond do
      s.port == nil or s.failure -> s
      byte_size(frame) > Protocol.record_limit() -> rejected(s, r, "pi_input_frame_limit")
      not Port.command(s.port, frame, [:nosuspend]) -> rejected(s, r, "pi_stdin_busy")
      true -> s
    end
  end

  defp effect({:broadcast, r}, s), do: effect({:broadcast, r, now()}, s)

  defp effect({:broadcast, r, observed}, s),
    do: broadcast(s, %{"op" => "event", "record" => r, "observedAt" => observed})

  defp effect({:transaction, engine, next, ref, request, payload}, s) do
    after_effect = effects(s, next)

    if not is_nil(after_effect.failure) or is_nil(after_effect.port) do
      Connection.deliver(ref, Protocol.error(request["id"], s.info.id, "pi_write_rejected"))
      after_effect
    else
      Connection.deliver(ref, Protocol.response(request["id"], s.info.id, payload))
      %{after_effect | engine: engine}
    end
  end

  defp effect({:ready}, s), do: lifecycle(s, "ready", %{})
  defp effect({:fail, code}, s), do: fail(s, code)

  defp effect({:subscribe, ref, r}, s) do
    record =
      Map.merge(Protocol.envelope("snapshot", s.info.id), %{
        "hub-instance" => s.info.instance,
        "seq" => s.seq,
        "payload" => %{
          "lifecycle" => s.state,
          "mode" => s.info.mode,
          "view" => Pi.snapshot(s.engine)
        }
      })

    if byte_size(Protocol.encode(record)) > Protocol.record_limit() do
      Connection.deliver(ref, Protocol.error(r["id"], s.info.id, "snapshot_frame_limit"))
      s
    else
      Connection.deliver(ref, record)
      Connection.deliver(ref, Protocol.response(r["id"], s.info.id, %{"agent-id" => s.info.id}))

      if Map.has_key?(s.subscribers, ref.pid),
        do: s,
        else: %{s | subscribers: Map.put(s.subscribers, ref.pid, {ref, s.clients[ref.pid]})}
    end
  end

  defp effect({:error, ref, r, code}, s) do
    Connection.deliver(ref, Protocol.error(r["id"], s.info.id, code))
    s
  end

  defp effect({:ok, ref, r, payload}, s) do
    Connection.deliver(ref, Protocol.response(r["id"], s.info.id, payload))
    s
  end

  defp effect({:reply, ref, r, result}, s) do
    record =
      if result["success"],
        do: Protocol.response(r["id"], s.info.id, result),
        else: Map.merge(Protocol.error(r["id"], s.info.id, "pi_rejected"), %{"payload" => result})

    Connection.deliver(ref, record)
    s
  end

  defp rejected(s, r, reason) do
    {engine, next} = Pi.reject_write(s.engine, r["id"])
    effects(%{s | engine: engine}, next) |> fail(reason)
  end

  defp lifecycle(s, state, detail) do
    GenServer.cast(Shield.Manager, {:state, s.info.id, state, not is_nil(s.port)})
    broadcast(%{s | state: state}, %{"op" => "lifecycle", "state" => state, "detail" => detail})
  end

  defp broadcast(s, payload) do
    seq = s.seq + 1

    r =
      Map.merge(Protocol.envelope("event", s.info.id), %{
        "hub-instance" => s.info.instance,
        "seq" => seq,
        "payload" => payload
      })

    Enum.each(s.subscribers, fn {_, {ref, _}} -> Connection.deliver(ref, r) end)
    %{s | seq: seq}
  end

  defp fail(%{failure: failure} = s, _) when not is_nil(failure), do: s

  defp fail(s, code) do
    {engine, pending} = Pi.failed(s.engine, code)
    s = effects(%{s | failure: code, engine: engine}, pending)
    s |> lifecycle("failed", %{"error" => code}) |> stop()
  end

  defp stop(%{port: nil} = s), do: s
  defp stop(%{stopping: true} = s), do: s

  defp stop(s) do
    signal(s.os_pid, "TERM")
    Process.send_after(self(), {:kill, s.os_pid}, 5000)
    s = %{s | stopping: true}
    if s.failure, do: s, else: lifecycle(s, "stopping", %{})
  end

  # This short OS operation runs under the lifetime owner, never a delayed worker.
  defp signal(pid, signal),
    do: System.cmd("/bin/kill", ["-" <> signal, Integer.to_string(pid)], stderr_to_stdout: true)

  defp now, do: System.system_time(:millisecond)

  def terminate(_, s) do
    if s.port, do: signal(s.os_pid, "TERM")
  end
end
