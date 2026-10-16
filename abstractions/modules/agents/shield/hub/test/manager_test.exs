# These tests cover Manager's writer-selection boundary: duplicate writers can corrupt
# history, and cwd-only selection can silently attach the wrong conversation. Types cannot
# prove selection or stop ordering; fake idle processes avoid duplicating Pi protocol tests.
defmodule Shield.ManagerTest do
  use ExUnit.Case
  alias Shield.{Manager, Protocol}

  setup do
    start_supervised!({Registry, keys: :unique, name: Shield.Registry})
    start_supervised!({DynamicSupervisor, strategy: :one_for_one, name: Shield.Agents})
    path = Path.join(System.tmp_dir!(), "shield-idle-#{System.unique_integer([:positive])}")
    File.write!(path, "while IFS= read -r line; do :; done\n")
    on_exit(fn -> File.rm(path) end)
    {:ok, state} = Manager.init([])
    %{state: state, path: path, ref: %{pid: self(), writer: self(), counter: :atomics.new(2, [])}}
  end

  defp request(key, path, kind \\ "identity", cwd \\ System.tmp_dir!()) do
    %{
      "id" => key,
      "type" => "hub_request",
      "method" => "attach",
      "payload" => %{
        "cwd" => cwd,
        "harness" => "quin",
        "selection" => %{"kind" => kind, "key" => key},
        "options" => %{
          "mode" => "mock",
          "model" => "fixture/fixed",
          "session" => %{"kind" => "new", "id" => key},
          "launch" => %{"executable" => "/bin/sh", "argv" => [path], "env" => %{}}
        }
      }
    }
  end

  @one "11111111-1111-4111-8111-111111111111"
  @two "22222222-2222-4222-8222-222222222222"

  test "starting identity is reserved, different identities coexist, ordinary attach joins newest",
       c do
    first = request(@one, c.path)

    first =
      put_in(first, ["payload", "options", "session"], %{
        "kind" => "resume",
        "id" => @one,
        "path" => c.path
      })

    {:noreply, s} = Manager.handle_cast({:request, c.ref, first}, c.state)
    [a] = Map.values(s.agents)
    assert a.state == "starting"
    {:noreply, s} = Manager.handle_cast({:request, c.ref, first}, s)
    assert map_size(s.agents) == 1
    assert s.agents[a.id].pid == a.pid

    second = request(@two, c.path)

    second =
      put_in(second, ["payload", "options", "session"], %{
        "kind" => "fork",
        "id" => @two,
        "path" => c.path
      })

    {:noreply, s} = Manager.handle_cast({:request, c.ref, second}, s)
    assert map_size(s.agents) == 2
    newest = Enum.max_by(Map.values(s.agents), & &1.order)
    ordinary = request("unused", c.path, "cwd")
    {:noreply, same} = Manager.handle_cast({:request, c.ref, ordinary}, s)
    assert same.next == s.next
    assert_receive {:routed, "unused", id}
    assert id == newest.id
  end

  test "stop reserves the identity until final exit, then permits restart", c do
    r = request(@one, c.path)
    {:noreply, s} = Manager.handle_cast({:request, c.ref, r}, c.state)
    [a] = Map.values(s.agents)
    stop = %{"id" => "stop", "method" => "stop", "payload" => %{"id" => a.id}}
    {:noreply, s} = Manager.handle_cast({:request, c.ref, stop}, s)
    assert s.agents[a.id].state == "stopping"
    # An initialization report already queued before stop must not reopen selection.
    {:noreply, s} = Manager.handle_cast({:state, a.id, "ready", true}, s)
    assert s.agents[a.id].state == "stopping"
    {:noreply, same} = Manager.handle_cast({:request, c.ref, r}, s)
    assert same.next == s.next
    assert_receive {:frame, frame, _}
    assert Protocol.decode(frame)["success"]
    assert_receive {:frame, frame, _}
    assert Protocol.decode(frame)["error"]["code"] == "agent_stopping"

    s = put_in(s, [:agents, a.id, :pid], nil)
    {:noreply, s} = Manager.handle_cast({:state, a.id, "exited", false}, s)
    {:noreply, s} = Manager.handle_cast({:request, c.ref, r}, s)
    assert s.next == 2
  end

  test "a different opaque key cannot start another writer for the same requested session", c do
    r = request(@one, c.path)
    {:noreply, s} = Manager.handle_cast({:request, c.ref, r}, c.state)
    forged = put_in(r, ["payload", "selection", "key"], @two)
    {:noreply, same} = Manager.handle_cast({:request, c.ref, forged}, s)
    assert same == s
    assert DynamicSupervisor.count_children(Shield.Agents).active == 1
    assert_receive {:frame, frame, _}
    assert Protocol.decode(frame)["error"]["code"] == "session_identity_mismatch"
  end

  test "the same opaque identity is separate in different execution modes", c do
    r = request(@one, c.path)
    {:noreply, s} = Manager.handle_cast({:request, c.ref, r}, c.state)
    live = put_in(r, ["payload", "options", "mode"], "live")
    {:noreply, s} = Manager.handle_cast({:request, c.ref, live}, s)
    assert map_size(s.agents) == 2
    assert MapSet.new(Map.values(s.agents), & &1.mode) == MapSet.new(["live", "mock"])
  end

  test "an identity cannot be reused with another cwd", c do
    r = request(@one, c.path)
    {:noreply, s} = Manager.handle_cast({:request, c.ref, r}, c.state)
    other = request(@one, c.path, "identity", "/")
    {:noreply, same} = Manager.handle_cast({:request, c.ref, other}, s)
    assert same.next == s.next
    assert_receive {:frame, frame, _}
    assert Protocol.decode(frame)["error"]["code"] == "harness_engine_mismatch"
  end
end
