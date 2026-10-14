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

  test "LF frames preserve split UTF8, CRLF, separators and null" do
    bytes =
      Protocol.encode(%{"text" => "日本\u2028語\u2029", "value" => nil})
      |> String.replace("\n", "\r\n")

    {records, tail} =
      Enum.reduce(:binary.bin_to_list(bytes), {[], ""}, fn byte, {all, tail} ->
        {r, tail} = Protocol.feed(tail, <<byte>>)
        {all ++ r, tail}
      end)

    assert tail == ""
    assert records == [%{"text" => "日本\u2028語\u2029", "value" => nil}]
    assert_raise JSON.DecodeError, fn -> Protocol.feed("", "not-json\n") end
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

    v = PiView.seed(PiView.new(), %{"entries" => entries, "leafId" => "two"})
    assert Enum.map(v["timeline"]["entries"], & &1["id"]) == ["seed:one", "seed:two"]
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

  test "attach checks model without replacing shared revision" do
    s = ready()
    {s, _} = Pi.output(s, %{"type" => "thinking_level_changed", "level" => "high"}, 1000)

    {s, [{:write, r}]} =
      Pi.attach(s, ref(), request("a", %{}), %{"model" => nil, "mode" => "mock"})

    {next, [{:subscribe, _, _}]} =
      Pi.output(
        s,
        %{
          "type" => "response",
          "id" => r["id"],
          "success" => true,
          "data" => %{"thinkingLevel" => "off"}
        },
        1000
      )

    assert next.view == s.view
    assert next.view["session"]["thinkingLevel"] == "high"
  end

  test "only an explicit model must match the existing root" do
    s = ready()
    state = %{"model" => %{"provider" => "fixture", "id" => "fixed"}}

    for {source, expected} <- [{"default", :subscribe}, {"explicit", :error}, {nil, :error}] do
      options = %{"model" => "other/model", "mode" => "mock", "modelSource" => source}
      {s, [{:write, r}]} = Pi.attach(s, ref(), request("a", %{}), options)

      {_, [effect]} =
        Pi.output(
          s,
          %{"type" => "response", "id" => r["id"], "success" => true, "data" => state},
          1000
        )

      assert elem(effect, 0) == expected
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
