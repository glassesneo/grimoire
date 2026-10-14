# Agents live only as long as the hub: attach joins the newest live root for a directory,
# and a restarted hub starts fresh agents while Pi's session files remain.
defmodule Shield.Manager do
  use GenServer
  alias Shield.{Protocol, Connection}
  def start_link(_), do: GenServer.start_link(__MODULE__, [], name: __MODULE__)

  def init(_),
    do:
      {:ok,
       %{
         instance: Base.encode16(:crypto.strong_rand_bytes(16), case: :lower),
         next: 0,
         agents: %{},
         closing: false
       }}

  def handle_cast({:request, ref, r}, s) do
    cond do
      s.closing ->
        error(ref, r, "hub_stopping")
        {:noreply, s}

      r["type"] == "engine_request" ->
        case s.agents[r["agent-id"]] do
          %{pid: pid, state: state} when state in ["starting", "ready"] ->
            GenServer.cast(pid, {:input, ref, r})
            {:noreply, s}

          _ ->
            error(ref, r, "agent_unavailable")
            {:noreply, s}
        end

      true ->
        hub_request(ref, r, s)
    end
  end

  def handle_cast({:state, id, state, alive}, s) do
    {:noreply, %{s | agents: Map.update!(s.agents, id, &%{&1 | state: state, alive: alive})}}
  end

  def handle_cast({:disconnect, pid}, s) do
    {:noreply,
     %{
       s
       | agents:
           Map.new(s.agents, fn {id, a} ->
             {id, %{a | subscribers: MapSet.delete(a.subscribers, pid)}}
           end)
     }}
  end

  defp hub_request(ref, r, s) do
    case r["method"] do
      "ping" ->
        reply(ref, r, %{"hub-instance" => s.instance, "hub-pid" => System.pid()})
        {:noreply, s}

      "list" ->
        reply(ref, r, Enum.map(s.agents, fn {_, a} -> public(a) end))
        {:noreply, s}

      "attach" ->
        attach(ref, r, s)

      "stop" ->
        case s.agents[r["payload"]["id"]] do
          %{pid: pid} when is_pid(pid) ->
            GenServer.cast(pid, :stop)
            reply(ref, r, %{})

          _ ->
            error(ref, r, "unknown_agent")
        end

        {:noreply, s}

      "shutdown" ->
        Enum.each(s.agents, fn {_, a} ->
          if a.alive, do: GenServer.cast(a.pid, :stop)
        end)

        reply(ref, r, %{})
        Process.send_after(self(), :shutdown_check, 50)
        {:noreply, %{s | closing: true}}

      _ ->
        error(ref, r, "unknown_method")
        {:noreply, s}
    end
  end

  defp attach(ref, r, s) do
    p = r["payload"]
    cwd = p["cwd"]
    options = p["options"]

    valid =
      is_binary(cwd) and Path.type(cwd) == :absolute and File.dir?(cwd) and p["harness"] == "quin" and
        is_map(options)

    if not valid do
      error(ref, r, "invalid_attach")
      {:noreply, s}
    else
      live =
        s.agents
        |> Map.values()
        |> Enum.filter(&(&1.cwd == cwd and &1.state in ["starting", "ready"]))
        |> Enum.max_by(& &1.order, fn -> nil end)

      case live do
        nil ->
          id = s.instance <> "-" <> Integer.to_string(s.next)

          case Shield.Pi.launch(options, cwd) do
            {:error, code} ->
              error(ref, r, code)
              {:noreply, s}

            {:ok, launch} ->
              info = %{
                id: id,
                cwd: cwd,
                harness: "quin",
                engine: "pi",
                mode: options["mode"],
                state: "starting",
                alive: true,
                order: s.next,
                instance: s.instance
              }

              case DynamicSupervisor.start_child(Shield.Agents, {Shield.Agent, {info, launch}}) do
                {:ok, pid} ->
                  monitor = Process.monitor(pid)

                  info =
                    Map.merge(info, %{
                      pid: pid,
                      monitor: monitor,
                      subscribers: MapSet.new([ref.pid])
                    })

                  GenServer.cast(pid, {:attach, ref, r, options})
                  {:noreply, %{s | next: s.next + 1, agents: Map.put(s.agents, id, info)}}

                _ ->
                  error(ref, r, "pi_start_failed")
                  {:noreply, s}
              end
          end

        a ->
          # The envelope may omit the engine; Pi is the only one, as at creation.
          if a.harness != p["harness"] or a.engine != (r["engine"] || "pi") do
            error(ref, r, "harness_engine_mode_mismatch")
            {:noreply, s}
          else
            GenServer.cast(a.pid, {:attach, ref, r, options})
            a = %{a | subscribers: MapSet.put(a.subscribers, ref.pid)}
            {:noreply, %{s | agents: Map.put(s.agents, a.id, a)}}
          end
      end
    end
  end

  # An agent that ended normally already reported its final lifecycle; any other exit
  # means its state owner crashed, which only this notice can report.
  def handle_info({:DOWN, monitor, :process, _, reason}, s) do
    agents =
      Map.new(s.agents, fn {id, a} ->
        cond do
          a.monitor != monitor ->
            {id, a}

          reason == :normal ->
            {id, %{a | pid: nil, alive: false}}

          true ->
            Enum.each(a.subscribers, &send(&1, {:agent_failed, id, reason}))
            {id, %{a | state: "failed", pid: nil, alive: false}}
        end
      end)

    {:noreply, %{s | agents: agents}}
  end

  def handle_info(:shutdown_check, s) do
    if Enum.any?(s.agents, fn {_, a} -> a.alive end) do
      Process.send_after(self(), :shutdown_check, 50)
    else
      GenServer.call(Shield.Listener, :close)

      spawn(fn ->
        Process.sleep(100)
        System.stop(0)
      end)
    end

    {:noreply, s}
  end

  defp public(a),
    do: %{
      "agent-id" => a.id,
      "cwd" => a.cwd,
      "harness" => a.harness,
      "engine" => a.engine,
      "state" => a.state,
      "parent-id" => nil
    }

  defp reply(ref, r, p), do: Connection.deliver(ref, Protocol.response(r["id"], r["agent-id"], p))
  defp error(ref, r, e), do: Connection.deliver(ref, Protocol.error(r["id"], r["agent-id"], e))
end
