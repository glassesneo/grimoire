# Key configuration rules a user relies on; types cannot reject a bad configuration.
defmodule Shield.Keel.KeysTest do
  use ExUnit.Case, async: true
  alias Shield.Keel.Keys

  @actions [
    %{"id" => "global.stop"},
    %{"id" => "screen.take_write"},
    %{"id" => "timeline.cursor_down", "keys" => ["j", "down"]},
    %{"id" => "timeline.cursor_up", "keys" => ["k", "up"]},
    %{"id" => "editor.submit", "keys" => ["return"]},
    %{"id" => "stage.next", "keys" => ["l"]}
  ]

  test "every key name parses alone and under every modifier combination" do
    printable = for c <- 0x21..0x7E, c not in ?A..?Z, do: <<c>>

    for name <- printable ++ ~w(space tab return kpenter escape up f12),
        mods <- [[], ["ctrl"], ["shift"], ["alt"], ["ctrl", "shift"], ["ctrl", "alt", "shift"]] do
      expected = Map.new(mods, &{String.to_atom(&1), true}) |> Map.put(:name, name)
      assert Keys.parse(Enum.join(mods ++ [name], "+")) == {:ok, expected}
    end

    for text <- ["", "ctrl+", "hyper+x", "x+ctrl", "ctrl++x", "enter", "esc", "Q", "pgdn"],
        do: assert({:error, _} = Keys.parse(text), text)

    assert {:error, message} = Keys.parse("ctrl+Q")
    assert message =~ "use shift+q"
  end

  test "a configured key or list replaces the defaults, and an empty list unbinds" do
    {keys, diagnostics} =
      Keys.apply(@actions, %{
        "global.stop" => "ctrl+c",
        "timeline.cursor_down" => ["n", "ctrl+n"],
        "editor.submit" => []
      })

    assert diagnostics == []
    assert keys["global.stop"] == ["ctrl+c"]
    assert keys["timeline.cursor_down"] == ["n", "ctrl+n"]
    assert keys["timeline.cursor_up"] == ["k", "up"]
    assert keys["editor.submit"] == []
    assert elem(Keys.apply(@actions, nil), 0)["global.stop"] == []
  end

  test "problems are reported and only the problematic bindings are dropped" do
    {keys, diagnostics} =
      Keys.apply(@actions, %{
        "timeline.missing" => "x",
        "timeline.cursor_down" => ["q", "nosuchkey"],
        "timeline.cursor_up" => "q",
        "editor.submit" => ["a", "kpenter"],
        "stage.next" => 3
      })

    # Each problem names its action and what is wrong, whatever its wording or order.
    reported = fn level, parts ->
      Enum.any?(diagnostics, fn {l, text} ->
        l == level and Enum.all?(parts, &String.contains?(text, &1))
      end)
    end

    assert length(diagnostics) == 5
    assert reported.("error", ["stage.next"])
    assert reported.("warning", ["timeline.missing"])
    assert reported.("error", ["timeline.cursor_down", "nosuchkey"])
    assert reported.("error", ["editor.submit", "types text"])
    assert reported.("error", ["timeline.cursor_down", "timeline.cursor_up"])

    assert keys["timeline.cursor_down"] == []
    assert keys["timeline.cursor_up"] == []
    assert keys["editor.submit"] == ["kpenter"]
    assert keys["stage.next"] == ["l"]
    assert [{"error", _}] = elem(Keys.apply(@actions, ["x"]), 1)
  end

  test "a global key wins over a region's, which is reported" do
    {keys, [{"warning", text}]} = Keys.apply(@actions, %{"screen.take_write" => "j"})
    assert text =~ "screen.take_write" and text =~ "timeline.cursor_down"
    # Both keep the chord; screens look the global layer up first.
    assert keys["screen.take_write"] == ["j"]
    assert keys["timeline.cursor_down"] == ["j", "down"]
  end

  test "a global action's default keys are not bound; only the configuration binds it" do
    actions = [%{"id" => "global.stop", "keys" => ["ctrl+c"]}]

    assert {%{"global.stop" => []}, [{"warning", text}]} = Keys.apply(actions, nil)
    assert text =~ "global.stop"

    assert Keys.apply(actions, %{"global.stop" => "ctrl+x"}) ==
             {%{"global.stop" => ["ctrl+x"]}, []}
  end
end
