# One agent: its OS process, its subscribers, and who may write. State events from the
# process reach live subscribers as `event` records carrying the process's own payload; the
# hub assigns them no sequence. The hub's own news (lifecycle, writer) reaches every
# subscriber, live or pending, as `management` records, outside the process's sequence.
defmodule Shield.Agent do
  use GenServer
  alias Shield.{Protocol, Connection}

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
    {engine, effects} = info.module.init(launch)
    queued = :atomics.new(1, [])
    writer = spawn_link(fn -> write_loop(port, queued) end)

    s = %{
      info: info,
      engine: engine,
      port: port,
      os_pid: os_pid,
      writer: writer,
      queued: queued,
      # Connection pid to %{ref:, live:, attaching:}; `attaching` until a first snapshot.
      subscribers: %{},
      clients: %{},
      # The connection that may write, and the number of writer changes so far.
      holder: nil,
      epoch: 0,
      buffer: Protocol.buffer(),
      state: "starting",
      stopping: false,
      failure: nil,
      ended: false
    }

    Process.send_after(self(), :startup_timeout, 60_000)
    Process.send_after(self(), :tick, 100)
    {:ok, effects(s, effects)}
  end

  def handle_cast({:attach, ref, r, options}, s) do
    if live?(s) do
      s = watch(s, ref)
      {engine, next} = s.info.module.attach(s.engine, ref, r, options)
      {:noreply, effects(%{s | engine: engine}, next)}
    else
      unavailable(s, ref, r, "agent_unavailable")
    end
  end

  def handle_cast({:input, ref, r}, s) do
    cond do
      not live?(s) ->
        unavailable(s, ref, r, "agent_unavailable")

      s.state == "starting" ->
        unavailable(s, ref, r, "agent_starting")

      true ->
        s = watch(s, ref)
        {engine, next} = s.info.module.input(s.engine, ref, r, now())
        {:noreply, effects(%{s | engine: engine}, next)}
    end
  end

  # Any subscriber, a viewer included, may take the write right.
  def handle_cast({:take_write, ref, r}, s) do
    cond do
      not live?(s) ->
        unavailable(s, ref, r, "agent_unavailable")

      not Map.has_key?(s.subscribers, ref.pid) ->
        unavailable(s, ref, r, "not_attached")

      true ->
        s = set_writer(s, ref)
        {:noreply, effect({:ok, ref, r, %{"connection" => ref.id, "epoch" => s.epoch}}, s)}
    end
  end

  def handle_cast(:stop, s), do: {:noreply, stop(s)}

  # The Manager forwards nothing after it has seen the final lifecycle, so every request it
  # forwarded earlier is already in this mailbox, and has been answered, when this arrives.
  def handle_cast(:release, %{ended: true} = s), do: {:stop, :normal, s}

  # Records are applied one at a time, so a record that cannot be applied fails the agent
  # from the state its predecessors left, after their effects were already delivered.
  def handle_info({port, {:data, bytes}}, %{port: port} = s) do
    case decode(s.buffer, bytes) do
      {:ok, records, buffer} ->
        {:noreply, Enum.reduce_while(records, %{s | buffer: buffer}, &output/2)}

      :error ->
        {:noreply, fail(s, "invalid_engine_frame")}
    end
  end

  # The agent ends with its engine process: the final lifecycle is delivered once, with a
  # failure's code beside the exit code, and the Agent then waits for the Manager's release.
  def handle_info({port, {:exit_status, code}}, %{port: port} = s) do
    {engine, pending} = s.info.module.failed(s.engine, "engine_exited")
    state = if s.stopping and is_nil(s.failure) and code in [0, 143], do: "exited", else: "failed"

    detail =
      if s.failure,
        do: %{"error" => s.failure, "exitCode" => code},
        else: %{"exitCode" => code}

    s = effects(%{s | port: nil, os_pid: nil, engine: engine}, pending)
    {:noreply, finish(s, state, detail)}
  end

  def handle_info({:EXIT, port, _}, %{port: port} = s), do: {:noreply, s}
  def handle_info({:EXIT, _, _}, s), do: {:noreply, s}

  def handle_info(:startup_timeout, %{state: "starting"} = s),
    do: {:noreply, fail(s, "engine_start_timeout")}

  def handle_info(:startup_timeout, s), do: {:noreply, s}

  def handle_info({:kill, pid}, %{os_pid: pid, port: port} = s) when not is_nil(port) do
    signal(pid, "KILL")
    Process.send_after(self(), {:kill_timeout, pid}, 1000)
    {:noreply, %{s | failure: s.failure || "forced_kill"}}
  end

  def handle_info({:kill, _}, s), do: {:noreply, s}

  def handle_info({:kill_timeout, pid}, %{os_pid: pid, port: port} = s) when not is_nil(port) do
    if Port.info(port), do: Port.close(port)
    {engine, pending} = s.info.module.failed(s.engine, "engine_exited")

    {:noreply,
     effects(%{s | engine: engine, port: nil, os_pid: nil}, pending)
     |> finish("failed", %{"error" => "exit_not_observed"})}
  end

  def handle_info({:kill_timeout, _}, s), do: {:noreply, s}

  def handle_info(:tick, %{ended: true} = s), do: {:noreply, s}

  def handle_info(:tick, s) do
    {engine, next} = s.info.module.expire(s.engine, now())
    Process.send_after(self(), :tick, 100)
    {:noreply, effects(%{s | engine: engine}, next)}
  end

  # A client that goes away loses its subscription and, if it held it, the write right; a
  # remaining viewer is not promoted.
  def handle_info({:DOWN, _, :process, pid, _}, s) do
    s = %{
      s
      | engine: s.info.module.detach(s.engine, pid),
        clients: Map.delete(s.clients, pid),
        subscribers: Map.delete(s.subscribers, pid)
    }

    s = if s.holder && s.holder.pid == pid, do: set_writer(s, nil), else: s
    {:noreply, s}
  end

  defp decode(buffer, bytes) do
    {records, buffer} = Protocol.feed(buffer, bytes)
    {:ok, records, buffer}
  rescue
    _ -> :error
  end

  defp output(_, %{failure: failure} = s) when not is_nil(failure), do: {:halt, s}

  defp output(r, s) do
    {engine, next} = s.info.module.output(s.engine, r, now())
    {:cont, effects(%{s | engine: engine}, next)}
  rescue
    _ -> {:halt, fail(s, "invalid_engine_frame")}
  end

  defp live?(s), do: s.state in ["starting", "ready"] and is_nil(s.failure) and not s.stopping

  defp unavailable(s, ref, r, code), do: {:noreply, effect({:error, ref, r, code}, s)}

  defp watch(s, ref) do
    if Map.has_key?(s.clients, ref.pid),
      do: s,
      else: %{s | clients: Map.put(s.clients, ref.pid, Process.monitor(ref.pid))}
  end

  defp set_writer(s, ref) do
    epoch = s.epoch + 1
    connection = if ref, do: ref.id, else: nil
    {engine, next} = s.info.module.writer(s.engine, connection, epoch)
    s = effects(%{s | engine: engine, holder: ref, epoch: epoch}, next)
    manage(s, %{"op" => "writer", "connection" => connection, "epoch" => epoch})
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
    size = byte_size(frame)

    cond do
      s.port == nil or s.failure ->
        s

      size > Protocol.record_limit() ->
        rejected(s, r, "engine_input_frame_limit")

      :atomics.get(s.queued, 1) + size > Protocol.record_limit() ->
        rejected(s, r, "engine_stdin_busy")

      true ->
        :atomics.add(s.queued, 1, size)
        send(s.writer, {:frame, frame})
        s
    end
  end

  defp effect({:broadcast, payload}, s) do
    deliver(s, for({_, %{ref: ref, live: true}} <- s.subscribers, do: ref), "event", %{
      "payload" => payload
    })
  end

  # A subscriber that subscribes again, to resynchronize, stays what it was.
  defp effect({:subscribe, ref}, s) do
    entry =
      case s.subscribers[ref.pid] do
        nil -> %{ref: ref, live: false, attaching: true}
        entry -> %{entry | live: false}
      end

    %{s | subscribers: Map.put(s.subscribers, ref.pid, entry)}
  end

  # The first subscriber to become live by attaching while nobody writes receives the write
  # right, before its snapshot, so its first write already finds it.
  defp effect({:snapshot, ref, r, payload}, s) do
    entry = s.subscribers[ref.pid]

    if is_nil(entry) do
      s
    else
      s = if is_nil(s.holder) and entry.attaching, do: set_writer(s, ref), else: s

      record =
        Map.merge(Protocol.envelope("snapshot", s.info.id, s.info.engine), %{
          "hub-instance" => s.info.instance,
          "connection" => ref.id,
          "lifecycle" => s.state,
          "writer" => %{"connection" => s.holder && s.holder.id, "epoch" => s.epoch},
          "payload" => payload
        })

      frame = Protocol.encode(record)

      if byte_size(frame) > Protocol.record_limit() do
        effect({:error, ref, r, "snapshot_frame_limit"}, s)
      else
        Connection.deliver_frame(ref, frame, record)
        s = update_in(s.subscribers[ref.pid], &%{&1 | live: true, attaching: false})

        effect(
          {:ok, ref, r, %{"agent-id" => s.info.id, "connection" => ref.id}},
          s
        )
      end
    end
  end

  defp effect({:transaction, engine, next, ref, request, payload}, s) do
    after_effect = effects(s, next)

    if not is_nil(after_effect.failure) or is_nil(after_effect.port),
      do: effect({:error, ref, request, "engine_write_rejected"}, after_effect),
      else: effect({:ok, ref, request, payload}, %{after_effect | engine: engine})
  end

  defp effect({:ready}, s), do: lifecycle(s, "ready", %{})
  defp effect({:fail, code}, s), do: fail(s, code)

  defp effect({:error, ref, r, code}, s) do
    Connection.deliver(ref, Protocol.error(r["id"], s.info.id, s.info.engine, code))
    s
  end

  defp effect({:error, ref, r, code, payload}, s) do
    Connection.deliver(
      ref,
      Map.put(Protocol.error(r["id"], s.info.id, s.info.engine, code), "payload", payload)
    )

    s
  end

  defp effect({:ok, ref, r, payload}, s) do
    Connection.deliver(ref, Protocol.response(r["id"], s.info.id, s.info.engine, payload))
    s
  end

  defp rejected(s, r, reason) do
    {engine, next} = s.info.module.reject_write(s.engine, r["id"])
    effects(%{s | engine: engine}, next) |> fail(reason)
  end

  defp lifecycle(s, state, detail) do
    GenServer.cast(Shield.Manager, {:state, s.info.id, state, not is_nil(s.port)})
    manage(%{s | state: state}, %{"op" => "lifecycle", "state" => state, "detail" => detail})
  end

  defp finish(s, state, detail), do: %{lifecycle(s, state, detail) | ended: true}

  defp manage(s, payload) do
    deliver(s, for({_, %{ref: ref}} <- s.subscribers, do: ref), "management", %{
      "hub-instance" => s.info.instance,
      "payload" => payload
    })
  end

  # One record for several connections, encoded once.
  defp deliver(s, [], _, _), do: s

  defp deliver(s, refs, type, fields) do
    r = Map.merge(Protocol.envelope(type, s.info.id, s.info.engine), fields)
    frame = Protocol.encode(r)
    Enum.each(refs, &Connection.deliver_frame(&1, frame, r))
    s
  end

  defp fail(%{failure: failure} = s, _) when not is_nil(failure), do: s

  # A failure is reported as `stopping` with its code; `failed` follows once the process
  # has exited.
  defp fail(s, code) do
    {engine, pending} = s.info.module.failed(s.engine, code)
    s = effects(%{s | failure: code, engine: engine}, pending)

    cond do
      is_nil(s.port) -> finish(s, "failed", %{"error" => code})
      s.stopping -> s
      true -> s |> lifecycle("stopping", %{"error" => code}) |> stop()
    end
  end

  defp stop(%{port: nil} = s), do: s
  defp stop(%{stopping: true} = s), do: s

  # TERM, then KILL after 5 s. Signals reach the engine's process only, so a KILL can leave
  # its descendants running.
  defp stop(s) do
    signal(s.os_pid, "TERM")
    Process.send_after(self(), {:kill, s.os_pid}, 5000)
    s = %{s | stopping: true}
    if s.failure, do: s, else: lifecycle(s, "stopping", %{})
  end

  # Writes block here instead of in the Agent, so a process that reads stdin slowly delays
  # only its own input.
  defp write_loop(port, queued) do
    receive do
      {:frame, frame} ->
        Port.command(port, frame)
        :atomics.sub(queued, 1, byte_size(frame))
        write_loop(port, queued)
    end
  end

  # This short OS operation runs under the lifetime owner, never a delayed worker.
  defp signal(pid, signal),
    do: System.cmd("/bin/kill", ["-" <> signal, Integer.to_string(pid)], stderr_to_stdout: true)

  defp now, do: System.system_time(:millisecond)

  def terminate(_, s) do
    Process.exit(s.writer, :kill)
    if s.port, do: signal(s.os_pid, "TERM")
  end
end
