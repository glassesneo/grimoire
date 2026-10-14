# Agents live only as long as the hub: attach joins the newest live root for a directory,
# and a restarted hub starts fresh agents while the engine's session files remain.
#
# Every request forwarded to an agent is answered once. An Agent that ends reports its final
# lifecycle and stops only when released, after the requests forwarded before that report.
# An Agent that crashes is reported per agent with `agent_failed` to the connections that
# attached to it or sent it requests; those connections stay open.
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
        # The Agent decides whether it takes the request; it only must not have ended.
        case s.agents[r["agent-id"]] do
          %{state: state} = a when state not in ["exited", "failed"] ->
            GenServer.cast(a.pid, {:input, ref, r})
            {:noreply, put_agent(s, peer(a, ref))}

          _ ->
            error(ref, r, "agent_unavailable")
            {:noreply, s}
        end

      true ->
        hub_request(ref, r, s)
    end
  end

  def handle_cast({:state, id, state, alive}, s) do
    a = %{s.agents[id] | state: state, alive: alive}
    if state in ["exited", "failed"] and is_pid(a.pid), do: GenServer.cast(a.pid, :release)
    {:noreply, put_agent(s, a)}
  end

  def handle_cast({:disconnect, pid}, s) do
    {:noreply,
     %{
       s
       | agents:
           Map.new(s.agents, fn {id, a} -> {id, %{a | peers: MapSet.delete(a.peers, pid)}} end)
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
    # The envelope may omit the engine; it then means the default one, at creation and join alike.
    name = r["engine"] || Shield.Engine.default()

    engine =
      case Shield.Engine.fetch(name) do
        {:ok, engine} -> engine
        :error -> nil
      end

    valid =
      is_binary(cwd) and Path.type(cwd) == :absolute and File.dir?(cwd) and engine != nil and
        p["harness"] in engine.harnesses() and is_map(options)

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

          case engine.launch(options, cwd) do
            {:error, code} ->
              error(ref, r, code)
              {:noreply, s}

            {:ok, launch} ->
              info = %{
                id: id,
                cwd: cwd,
                harness: p["harness"],
                engine: name,
                module: engine,
                state: "starting",
                alive: true,
                order: s.next,
                instance: s.instance
              }

              case DynamicSupervisor.start_child(Shield.Agents, {Shield.Agent, {info, launch}}) do
                {:ok, pid} ->
                  monitor = Process.monitor(pid)
                  a = Map.merge(info, %{pid: pid, monitor: monitor, peers: MapSet.new()})
                  forward_attach(a, ref, r, options)
                  {:noreply, put_agent(%{s | next: s.next + 1}, peer(a, ref))}

                _ ->
                  error(ref, r, "engine_start_failed")
                  {:noreply, s}
              end
          end

        a ->
          if a.harness != p["harness"] or a.engine != name do
            error(ref, r, "harness_engine_mismatch")
            {:noreply, s}
          else
            forward_attach(a, ref, r, options)
            {:noreply, put_agent(s, peer(a, ref))}
          end
      end
    end
  end

  # The connection learns which agent answers the attach, so an Agent crash can answer it.
  defp forward_attach(a, ref, r, options) do
    send(ref.pid, {:routed, r["id"], a.id})
    GenServer.cast(a.pid, {:attach, ref, r, options})
  end

  defp peer(a, ref), do: %{a | peers: MapSet.put(a.peers, ref.pid)}
  defp put_agent(s, a), do: %{s | agents: Map.put(s.agents, a.id, a)}

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
            Enum.each(a.peers, &send(&1, {:agent_failed, id, reason}))
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

  defp reply(ref, r, p),
    do: Connection.deliver(ref, Protocol.response(r["id"], r["agent-id"], r["engine"], p))

  defp error(ref, r, e),
    do: Connection.deliver(ref, Protocol.error(r["id"], r["agent-id"], r["engine"], e))
end
