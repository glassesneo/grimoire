# Actor-independent Pi policy tests: no type/evaluation check can detect these ordering failures.
defmodule Shield.PiTest do
  use ExUnit.Case
  alias Shield.{Pi, PiView, Protocol}
  defp ref, do: %{pid: self()}
  defp request(id, payload), do: %{"id" => id, "payload" => payload}

  defp ready do
    {s, _} = Pi.init(%{model: "fixture/fixed", mode: "mock"})
    model = %{"provider" => "fixture", "id" => "fixed"}

    records = [
      %{
        "type" => "response",
        "id" => "shield:0",
        "success" => true,
        "data" => %{"entries" => [], "leafId" => nil}
      },
      %{
        "type" => "response",
        "id" => "shield:1",
        "success" => true,
        "data" => %{
          "model" => model,
          "isStreaming" => false,
          "isCompacting" => false,
          "pendingMessageCount" => 0
        }
      },
      %{
        "type" => "response",
        "id" => "shield:2",
        "success" => true,
        "data" => %{"models" => [model]}
      }
    ]

    Enum.reduce(records, s, fn r, s -> elem(Pi.output(s, r, 1000), 0) end)
  end

  # Records must not depend on how the transport chunks their bytes.
  defp feed_all(bytes, size) do
    {records, buffer} =
      bytes
      |> chunks(size)
      |> Enum.reduce({[], Protocol.buffer()}, fn chunk, {all, buffer} ->
        {records, buffer} = Protocol.feed(buffer, chunk)
        {[records | all], buffer}
      end)

    {records |> Enum.reverse() |> List.flatten(), Protocol.buffered(buffer)}
  end

  defp chunks(<<>>, _), do: []

  defp chunks(bytes, size) when byte_size(bytes) <= size, do: [bytes]

  defp chunks(bytes, size) do
    <<chunk::binary-size(size), rest::binary>> = bytes
    [chunk | chunks(rest, size)]
  end

  test "framing yields the same records however the bytes are chunked" do
    records = [
      %{"text" => "日本\u2028語\u2029", "value" => nil},
      %{"empty" => ""},
      %{"large" => String.duplicate("x", 300_000)}
    ]

    bytes = Enum.map_join(records, &(Protocol.encode(&1) |> String.replace("\n", "\r\n")))

    for size <- [1, 2, 3, 7, 4096, 65_536, byte_size(bytes)] do
      assert feed_all(bytes, size) == {records, 0}
    end

    {[], held} = feed_all(binary_part(bytes, 0, 10), 3)
    assert held == 10
    assert_raise JSON.DecodeError, fn -> Protocol.feed(Protocol.buffer(), "not-json\n") end
  end

  test "framing rejects a record over the limit, however it is chunked" do
    over = :binary.copy("x", Protocol.record_limit() + 1)

    for size <- [65_536, byte_size(over)] do
      assert_raise ArgumentError, fn -> feed_all(over, size) end
      assert_raise ArgumentError, fn -> feed_all(over <> "\n", size) end
    end
  end

  test "seed follows parentId, excludes abandoned branches, and never merges identical text" do
    entries = [
      %{
        "id" => "one",
        "parentId" => nil,
        "type" => "message",
        "message" => %{"role" => "user", "content" => "same"}
      },
      %{
        "id" => "abandoned",
        "parentId" => "one",
        "type" => "message",
        "message" => %{"role" => "user", "content" => "not visible"}
      },
      %{
        "id" => "two",
        "parentId" => "one",
        "type" => "message",
        "message" => %{"role" => "user", "content" => "same"}
      }
    ]

    v = PiView.seed(PiView.new(), %{"entries" => entries, "leafId" => "two"}) |> PiView.snapshot()
    assert Enum.map(v["timeline"]["entries"], & &1["id"]) == ["seed:one", "seed:two"]
  end

  test "seed restores the branch as the harness does, nested calls from the result's summary" do
    entry = fn id, parent, fields -> Map.merge(%{"id" => id, "parentId" => parent}, fields) end

    entries = [
      entry.("m1", nil, %{"type" => "model_change", "provider" => "a", "modelId" => "one"}),
      entry.("t1", "m1", %{"type" => "thinking_level_change", "thinkingLevel" => "low"}),
      entry.("m2", "t1", %{"type" => "model_change", "provider" => "b", "modelId" => "two"}),
      entry.("call", "m2", %{
        "type" => "message",
        "message" => %{
          "role" => "assistant",
          "content" => [
            %{"type" => "toolCall", "id" => "c", "name" => "codemode", "arguments" => %{}}
          ]
        }
      }),
      entry.("result", "call", %{
        "type" => "message",
        "message" => %{
          "role" => "toolResult",
          "toolCallId" => "c",
          "content" => [],
          "isError" => false,
          "nestedCalls" => %{
            "complete" => false,
            "calls" => [
              %{"id" => "1", "name" => "read", "arguments" => %{"path" => "a"}, "status" => "ok"},
              %{
                "id" => "1/1",
                "name" => "bash",
                "argumentsBytes" => 9,
                "status" => "error",
                "error" => "x"
              },
              %{"id" => "gone/2", "name" => "read", "status" => "unfinished"}
            ]
          }
        }
      }),
      entry.("summary", "result", %{"type" => "branch_summary", "summary" => "elsewhere"}),
      entry.("bash", "summary", %{
        "type" => "message",
        "message" => %{
          "role" => "bashExecution",
          "command" => "ls",
          "output" => "a",
          "exitCode" => 0
        }
      })
    ]

    v =
      PiView.seed(PiView.new(), %{"entries" => entries, "leafId" => "bash"}) |> PiView.snapshot()

    by_id = Map.new(v["timeline"]["entries"], &{&1["id"], &1})

    assert [%{"setting" => "model", "from" => "a/one", "to" => "b/two"}] =
             Enum.filter(v["timeline"]["entries"], &(&1["kind"] == "config"))

    assert %{"state" => "done", "nestedIncomplete" => true} = by_id["seed:call/c"]

    assert %{"parentId" => "seed:call/c", "state" => "done", "ordinal" => 0} =
             by_id["seed:call/1"]

    assert %{
             "parentId" => "seed:call/1",
             "state" => "error",
             "errorSummary" => "x",
             "args" => %{"available" => false, "bytes" => 9}
           } = by_id["seed:call/1/1"]

    assert %{"parentId" => "seed:call/c", "state" => "unfinished"} = by_id["seed:call/gone/2"]
    assert %{"kind" => "branch-summary", "summary" => "elsewhere"} = by_id["seed:summary"]
    assert %{"kind" => "bash", "command" => "ls", "exitCode" => 0} = by_id["seed:bash"]
  end

  test "an attach in the other mode is refused, and Pi's own rejection carries its response" do
    s = ready()
    assert %{"mode" => "mock", "view" => _} = Pi.snapshot(s)

    {_, [{:error, _, _, "mode_mismatch"}]} =
      Pi.attach(s, ref(), request("a", %{}), %{"mode" => "live"})

    get = request("g", %{"op" => "rpc", "record" => %{"type" => "get_state"}})
    {s, [{:write, w}]} = Pi.input(s, ref(), get, 1000)
    rejected = %{"type" => "response", "id" => w["id"], "success" => false, "error" => "no"}
    {_, [{:error, _, _, "engine_rejected", payload}]} = Pi.output(s, rejected, 1000)
    assert payload["id"] == "g" and payload["error"] == "no"
  end

  test "interrupt fences preflights before clear/abort and rejects new sends" do
    s = ready()

    prompt =
      request("p", %{"op" => "rpc", "record" => %{"type" => "prompt", "message" => "hello"}})

    {s, [{:write, sent} | _]} = Pi.input(s, ref(), prompt, 1000)
    {s, effects} = Pi.input(s, ref(), request("i", %{"op" => "interrupt"}), 1000)
    refute Enum.any?(effects, &match?({:write, _}, &1))
    {_, [{:error, _, _, "interrupting"}]} = Pi.input(s, ref(), prompt, 1000)

    {s, effects} =
      Pi.output(s, %{"type" => "response", "id" => sent["id"], "success" => true}, 1000)

    {:write, clear} = Enum.find(effects, &match?({:write, _}, &1))
    assert clear["type"] == "clear_queue"

    {s, [{:write, abort}]} =
      Pi.output(s, %{"type" => "response", "id" => clear["id"], "success" => true}, 1000)

    assert abort["type"] == "abort"
    {s, _} = Pi.output(s, %{"type" => "response", "id" => abort["id"], "success" => true}, 1000)
    assert s.interrupt == nil
  end

  test "interrupt cancels dialogs observed during clear and abort phases" do
    s = ready()
    {s, initial} = Pi.input(s, ref(), request("i", %{"op" => "interrupt"}), 1000)
    {:write, clear} = Enum.find(initial, &match?({:write, _}, &1))
    assert clear["type"] == "clear_queue"

    dialog = %{
      "type" => "extension_ui_request",
      "method" => "input",
      "id" => "during-clear",
      "title" => "Input"
    }

    {s, effects} = Pi.output(s, dialog, 1001)

    assert Enum.count(
             effects,
             &match?(
               {:write,
                %{"type" => "extension_ui_response", "id" => "during-clear", "cancelled" => true}},
               &1
             )
           ) == 1

    refute s.view["dialogs"]["during-clear"]

    {s, [{:write, abort}]} =
      Pi.output(s, %{"type" => "response", "id" => clear["id"], "success" => true}, 1002)

    assert abort["type"] == "abort"

    dialog = %{
      "type" => "extension_ui_request",
      "method" => "confirm",
      "id" => "during-abort",
      "title" => "Confirm"
    }

    {s, effects} = Pi.output(s, dialog, 1003)

    assert Enum.count(
             effects,
             &match?(
               {:write,
                %{"type" => "extension_ui_response", "id" => "during-abort", "cancelled" => true}},
               &1
             )
           ) == 1

    refute s.view["dialogs"]["during-abort"]

    {s, _} = Pi.output(s, %{"type" => "response", "id" => abort["id"], "success" => true}, 1004)
    assert s.interrupt == nil
  end

  test "dialog commits only after transport succeeds, and zero timeout stays answerable" do
    s = ready()

    {s, _} =
      Pi.output(
        s,
        %{
          "type" => "extension_ui_request",
          "method" => "select",
          "id" => "d",
          "options" => ["one"],
          "timeout" => 0
        },
        1000
      )

    {s, _} = Pi.expire(s, 2000)
    assert s.view["dialogs"]["d"]
    r = request("reply", %{"op" => "dialog_reply", "id" => "d", "value" => "one"})
    {unchanged, [{:transaction, committed, _, _, _, _}]} = Pi.input(s, ref(), r, 2000)
    assert unchanged.view["dialogs"]["d"]
    refute committed.view["dialogs"]["d"]
    {_, [{:error, _, _, "dialog_closed_or_invalid"}]} = Pi.input(committed, ref(), r, 2000)
  end

  test "attaching to a ready root subscribes at once, whatever model it names" do
    s = ready()
    {s, _} = Pi.output(s, %{"type" => "thinking_level_changed", "level" => "high"}, 1000)

    for model <- [nil, "fixture/fixed", "other/model"] do
      {next, [{:subscribe, _, _}]} =
        Pi.attach(s, ref(), request("a", %{}), %{"model" => model, "mode" => "mock"})

      assert next == s
    end
  end

  test "a model change reaches every view, whether or not its requester stayed" do
    model = %{"provider" => "other", "id" => "model"}

    set = %{
      "op" => "rpc",
      "record" => %{"type" => "set_model", "provider" => "other", "modelId" => "model"}
    }

    for detached <- [false, true], success <- [true, false] do
      {s, [{:write, w}]} = Pi.input(ready(), ref(), request("m", set), 1000)
      s = if detached, do: Pi.detach(s, self()), else: s
      data = if success, do: model, else: nil
      response = %{"type" => "response", "id" => w["id"], "success" => success, "data" => data}
      {next, effects} = Pi.output(s, response, 1000)
      broadcasts = for {:broadcast, payload} <- effects, do: payload["record"]

      if success do
        assert broadcasts == [%{"type" => "shield_model", "model" => model}]
        assert next.view["timeline"]["model"] == "other/model"

        assert [%{"kind" => "config", "from" => "fixture/fixed", "to" => "other/model"}] =
                 Pi.snapshot(next)["view"]["timeline"]["entries"]
      else
        assert broadcasts == []
        assert next.view == s.view
      end

      assert Enum.any?(effects, &(elem(&1, 0) == if(success, do: :ok, else: :error))) ==
               not detached
    end
  end

  test "palette commands reach Pi only with well-formed arguments" do
    cases = [
      {%{"type" => "set_model", "provider" => "p", "modelId" => "m"}, true},
      {%{"type" => "set_model", "provider" => "p"}, false},
      {%{"type" => "set_model", "provider" => 1, "modelId" => "m"}, false},
      {%{"type" => "set_thinking_level", "level" => "high"}, true},
      {%{"type" => "set_thinking_level"}, false},
      {%{"type" => "compact"}, true},
      {%{"type" => "compact", "customInstructions" => "keep tests"}, true},
      {%{"type" => "compact", "customInstructions" => 3}, false},
      {%{"type" => "compact", "extra" => true}, false},
      {%{"type" => "new_session"}, false}
    ]

    for {record, accepted} <- cases do
      {_, [effect]} =
        Pi.input(ready(), ref(), request("c", %{"op" => "rpc", "record" => record}), 1000)

      assert match?({:write, _}, effect) == accepted, inspect(record)
    end
  end

  test "a dialog reply is accepted only when it fits the dialog, and nothing malformed crashes" do
    dialogs = [
      %{"method" => "select", "options" => ["one", "two"]},
      %{"method" => "select", "options" => nil},
      %{"method" => "select", "options" => %{"one" => 1}},
      %{"method" => "select", "options" => "one"},
      %{"method" => "confirm"},
      %{"method" => "input"},
      %{"method" => "editor"}
    ]

    replies = [
      %{"value" => "one"},
      %{"value" => "three"},
      %{"value" => ["one"]},
      %{"value" => nil},
      %{"confirmed" => true},
      %{"confirmed" => "yes"},
      %{"cancelled" => true},
      %{}
    ]

    for dialog <- dialogs, reply <- replies do
      {s, _} =
        Pi.output(
          ready(),
          Map.merge(dialog, %{"type" => "extension_ui_request", "id" => "d"}),
          1000
        )

      r = request("reply", Map.merge(reply, %{"op" => "dialog_reply", "id" => "d"}))
      {_, [effect | _]} = Pi.input(s, ref(), r, 1000)

      fits =
        reply["cancelled"] == true or
          case dialog["method"] do
            "select" -> is_list(dialog["options"]) and reply["value"] in dialog["options"]
            "confirm" -> is_boolean(reply["confirmed"])
            _ -> is_binary(reply["value"])
          end

      assert elem(effect, 0) == if(fits, do: :transaction, else: :error),
             "#{inspect(dialog)} answered with #{inspect(reply)}"
    end
  end

  test "forbidden RPC and slash new never enter Pi stdin" do
    for record <- [
          %{"type" => "new_session"},
          %{"type" => "bash", "command" => "echo x"},
          %{"type" => "prompt", "message" => "/new"}
        ] do
      {_, [{:error, _, _, "unsupported_or_invalid_rpc"}]} =
        Pi.input(ready(), ref(), request("x", %{"op" => "rpc", "record" => record}), 1000)
    end
  end
end
