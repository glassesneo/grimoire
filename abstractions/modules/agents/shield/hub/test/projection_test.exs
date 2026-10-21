# The model gives the items, versions, and order the TypeScript projection gave for the same
# entries (test/fixtures/projection.json, captured from it before the model moved here). Each
# captured step goes to the model as the driver's entries record; what screens receive (the
# event's items and order, and the snapshot's items) is compared.
defmodule Shield.Keel.ProjectionTest do
  use ExUnit.Case, async: true
  alias Shield.Keel.Model

  @fixture Path.expand("fixtures/projection.json", __DIR__) |> File.read!() |> JSON.decode!()

  defp ready do
    session = %{"id" => "s", "cwd" => "/", "model" => nil, "thinking" => nil}

    {model, _} =
      Model.driver_record(Model.new("i"), %{"type" => "ready", "session" => session}, 0)

    model
  end

  # The items of `entries` sent as one record, as screens see them.
  defp items(entries) do
    {model, _} = Model.driver_record(ready(), %{"type" => "entries", "entries" => entries}, 0)
    Model.snapshot(model)["state"]["items"]
  end

  for %{"name" => name, "steps" => steps} <- @fixture["cases"] do
    @steps steps
    test "as captured: #{name}" do
      Enum.reduce(Enum.with_index(@steps), ready(), fn {step, n}, model ->
        record = %{"type" => "entries", "entries" => step["entries"]}
        record = if step["order"], do: Map.put(record, "order", step["order"]), else: record

        {model, out} = Model.driver_record(model, record, 0)

        changes = for {:broadcast, %{"changes" => c}} <- out, do: c
        changes = List.first(changes, %{})
        assert Model.snapshot(model)["state"]["items"] == step["items"], "step #{n}: items"

        assert Enum.map(changes["items"] || [], & &1["id"]) == step["changed"],
               "step #{n}: changed"

        assert Map.has_key?(changes, "order") == step["reorder"], "step #{n}: order"
        model
      end)
    end
  end

  defp response(text, streaming \\ false) do
    %{
      "kind" => "assistant",
      "id" => "r",
      "version" => 0,
      "parts" => [%{"type" => "text", "text" => text}],
      "streaming" => streaming
    }
  end

  defp parts(text), do: text |> response() |> List.wrap() |> items() |> tl()

  test "an open fence runs to the end, and only a matching fence closes it" do
    assert [
             %{"kind" => "prose", "text" => "a"},
             %{
               "kind" => "code",
               "data" => %{"language" => "ts", "body" => "x\n~~~", "open" => true}
             }
           ] =
             parts("a\n```ts\nx\n~~~")

    assert [
             %{"kind" => "code", "data" => %{"body" => "x", "open" => false}},
             %{"kind" => "prose", "text" => "b"}
           ] =
             parts("````\nx\n````\nb")

    assert [%{"kind" => "prose", "text" => "```ts\r"}] = parts("```ts\r")
  end

  test "a streamed response ends split as a whole response would be" do
    text = "intro\n\n```ts\nconst a = 1;\n```\nmiddle\n~~~\nraw\n"

    streamed =
      Enum.reduce(1..String.length(text), ready(), fn n, model ->
        record = %{"type" => "entries", "entries" => [response(String.slice(text, 0, n), true)]}
        {model, _} = Model.driver_record(model, record, 0)
        model
      end)

    {model, _} =
      Model.driver_record(streamed, %{"type" => "entries", "entries" => [response(text)]}, 0)

    strip = fn items -> Enum.map(items, &Map.delete(&1, "version")) end
    assert strip.(Model.snapshot(model)["state"]["items"]) == strip.(items([response(text)]))
  end

  # The one intended difference: object arguments are summarized in key order.
  test "tool arguments are summarized in the order of their keys, cut to the item's width" do
    tool = fn value ->
      [item] =
        items([
          %{
            "kind" => "tool",
            "id" => "t",
            "version" => 0,
            "callId" => "t",
            "name" => "write",
            "args" => %{"available" => true, "value" => value},
            "state" => "done"
          }
        ])

      item["text"]
    end

    assert tool.(%{"path" => "b", "content" => "x\ny"}) == "write content=x ⏎ y path=b · done"
    long = tool.(%{"text" => String.duplicate("x", 200)})
    assert String.ends_with?(long, "… · done")
    assert String.length(String.trim_trailing(long, " · done")) == 120 + String.length("write ")
  end
end
