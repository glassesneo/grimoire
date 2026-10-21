# The Agent's guarantees to screens, against a scripted keel driver: who may write, that a
# subscriber gets events only after its snapshot, and that hub news never takes a state seq.
# keel's model checks the writer it is told about; the `write` action exercises that.
defmodule Shield.AgentTest do
  use ExUnit.Case
  alias Shield.{Agent, Keel, Protocol}

  setup do
    start_supervised!({Registry, keys: :unique, name: Shield.Registry})
    dir = Path.join(System.tmp_dir!(), "shield-agent-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf(dir) end)
    elixir = System.find_executable("elixir")
    script = Path.expand("support/fake_driver.exs", __DIR__)

    options = %{
      "configDir" => dir,
      "launch" => %{
        "executable" => elixir,
        "argv" => [script],
        "env" => Map.take(System.get_env(), ["PATH", "HOME", "LANG"])
      }
    }

    {:ok, launch} = Keel.launch(options, dir, "key")

    info = %{
      id: "agent-#{System.unique_integer([:positive])}",
      engine: "keel",
      module: Keel,
      instance: "hub"
    }

    {:ok, agent} = Agent.start_link({info, launch})
    %{agent: agent, options: options}
  end

  # A connection stand-in: the Agent's frames arrive at this test tagged with its name.
  defp client(name) do
    test = self()

    pid =
      spawn(fn ->
        receive_loop = fn loop ->
          receive do
            {:frame, frame, _} ->
              send(test, {name, Protocol.decode(frame)})
              loop.(loop)

            _ ->
              loop.(loop)
          end
        end

        receive_loop.(receive_loop)
      end)

    %{pid: pid, id: name, writer: pid, counter: :atomics.new(2, [])}
  end

  defp next(name, type) do
    receive do
      {^name, %{"type" => ^type} = r} -> r
    after
      5000 -> flunk("#{name} received no #{type}")
    end
  end

  # Management records arrive in order; earlier ones may still be waiting.
  defp management(name, match) do
    receive do
      {^name, %{"type" => "management", "payload" => payload}} ->
        if match.(payload), do: payload, else: management(name, match)
    after
      5000 -> flunk("#{name} received no matching management record")
    end
  end

  defp response(name, id) do
    receive do
      {^name, %{"type" => "response", "id" => ^id} = r} -> r
    after
      5000 -> flunk("#{name} received no response #{id}")
    end
  end

  defp attach(agent, ref, options) do
    GenServer.cast(agent, {:attach, ref, %{"id" => "attach-#{ref.id}"}, options})
    snapshot = next(ref.id, "snapshot")
    assert response(ref.id, "attach-#{ref.id}")["success"]
    snapshot
  end

  defp invoke(agent, ref, id, action, epoch \\ nil) do
    payload = %{"op" => "invoke", "action" => "fake." <> action}
    payload = if epoch, do: Map.put(payload, "writerEpoch", epoch), else: payload
    GenServer.cast(agent, {:input, ref, %{"id" => id, "payload" => payload}})

    response(ref.id, id)
  end

  defp ready(agent) do
    Enum.find_value(1..100, fn _ ->
      if :sys.get_state(agent).state == "ready", do: true, else: Process.sleep(20) && nil
    end)
  end

  test "the first screen writes, a second views, take_write moves the right, and a late write is refused",
       c do
    ready(c.agent)
    a = client("ca")
    b = client("cb")
    first = attach(c.agent, a, c.options)
    assert first["writer"] == %{"connection" => "ca", "epoch" => 1}
    assert first["connection"] == "ca"
    second = attach(c.agent, b, c.options)
    assert second["writer"] == %{"connection" => "ca", "epoch" => 1}
    assert invoke(c.agent, b, "w1", "write", 1)["payload"]["code"] == "not_writer"
    assert invoke(c.agent, a, "w2", "write", 1)["payload"]["outcome"] == "done"
    # View and control actions are the model's to allow; the hub does not filter them.
    assert invoke(c.agent, b, "v1", "look")["payload"]["detail"] == "cb"

    GenServer.cast(c.agent, {:take_write, b, %{"id" => "take"}})
    assert response("cb", "take")["payload"] == %{"connection" => "cb", "epoch" => 2}

    for name <- ["ca", "cb"],
        do: management(name, &(&1 == %{"op" => "writer", "connection" => "cb", "epoch" => 2}))

    assert invoke(c.agent, a, "w3", "write", 2)["payload"]["code"] == "not_writer"
    assert invoke(c.agent, b, "w4", "write", 2)["payload"]["outcome"] == "done"
  end

  test "a writer that goes away frees the right without promoting a viewer", c do
    ready(c.agent)
    a = client("ca")
    b = client("cb")
    attach(c.agent, a, c.options)
    attach(c.agent, b, c.options)
    Process.exit(a.pid, :kill)

    management("cb", &(&1 == %{"op" => "writer", "connection" => nil, "epoch" => 2}))

    assert invoke(c.agent, b, "w1", "write", 2)["payload"]["code"] == "not_writer"
    # The next screen to attach takes it.
    third = client("cc")
    assert attach(c.agent, third, c.options)["writer"] == %{"connection" => "cc", "epoch" => 3}
  end

  test "a viewer that resynchronizes stays a viewer, even with nobody writing", c do
    ready(c.agent)
    a = client("ca")
    b = client("cb")
    attach(c.agent, a, c.options)
    attach(c.agent, b, c.options)
    Process.exit(a.pid, :kill)
    management("cb", &(&1 == %{"op" => "writer", "connection" => nil, "epoch" => 2}))

    GenServer.cast(
      c.agent,
      {:input, b, %{"id" => "resync", "payload" => %{"op" => "snapshot"}}}
    )

    assert next("cb", "snapshot")["writer"] == %{"connection" => nil, "epoch" => 2}
    assert response("cb", "resync")["success"]
    assert invoke(c.agent, b, "w1", "write", 2)["payload"]["code"] == "not_writer"
  end

  test "events carry the model's numbers, start after the snapshot, and hub news has none", c do
    ready(c.agent)
    a = client("ca")
    invoke(c.agent, a, "e0", "emit")
    snapshot = attach(c.agent, a, c.options)
    seq = snapshot["payload"]["seq"]
    assert Enum.map(snapshot["payload"]["state"]["items"], & &1["id"]) == ["notice-0"]
    assert invoke(c.agent, a, "e1", "emit")["payload"]["appliedSeq"] == seq + 1
    event = next("ca", "event")

    assert %{"seq" => next_seq, "changes" => %{"items" => [%{"id" => "notice-1"}]}} =
             event["payload"]

    assert next_seq == seq + 1
    refute Map.has_key?(event, "seq")

    GenServer.cast(c.agent, :stop)

    receive do
      {"ca", %{"type" => "management", "payload" => %{"op" => "lifecycle"}} = record} ->
        refute Map.has_key?(record, "seq")
    after
      5000 -> flunk("no lifecycle record")
    end
  end

  test "a request the contract does not admit is refused before the model sees it", c do
    ready(c.agent)
    a = client("ca")
    attach(c.agent, a, c.options)

    GenServer.cast(
      c.agent,
      {:input, a,
       %{
         "id" => "bad",
         "payload" => %{"op" => "invoke", "action" => "fake.look", "writerEpoch" => "1"}
       }}
    )

    assert response("ca", "bad")["error"]["code"] == "invalid_request"
  end

  test "only a subscriber may take the write, and an unanswered invoke ends unknown when the driver exits",
       c do
    ready(c.agent)
    a = client("ca")
    GenServer.cast(c.agent, {:take_write, a, %{"id" => "take"}})
    assert response("ca", "take")["error"]["code"] == "not_attached"
    attach(c.agent, a, c.options)

    GenServer.cast(
      c.agent,
      {:input, a, %{"id" => "s1", "payload" => %{"op" => "invoke", "action" => "fake.silent"}}}
    )

    GenServer.cast(
      c.agent,
      {:input, a, %{"id" => "x", "payload" => %{"op" => "invoke", "action" => "fake.crash"}}}
    )

    assert %{"outcome" => "unknown", "code" => "acceptance_unknown"} =
             response("ca", "s1")["payload"]
  end

  test "an agent serves one configuration directory", c do
    ready(c.agent)
    a = client("ca")
    other = %{c.options | "configDir" => System.tmp_dir!()}
    GenServer.cast(c.agent, {:attach, a, %{"id" => "attach"}, other})
    assert response("ca", "attach")["error"]["code"] == "config_dir_mismatch"
  end
end
