# The key configuration applied to the declared actions. The model publishes each action's
# chords; screens resolve keys against them (keel/protocol/keys.ts).
#
# An action's layer is its id's prefix when that names a focus region (`editor`, `timeline`,
# `stage`), and the global layer otherwise. Screens consult the global layer first. Global
# actions have no default chords: defaults one declares are reported and not bound.
#
# A key is a single character or a name OpenTUI reports, such as `return`, `escape`, or
# `space`; a capital letter is `shift+<letter>`. keybindings.json maps an action id to one
# chord or a list; an empty list unbinds the action. Problems never stop the agent: an
# unknown action is reported; a global chord that shadows a region's is reported and the
# global one wins; an unknown key, a character chord in the editor, or a chord bound twice in
# one layer is reported and that binding is dropped.
defmodule Shield.Keel.Keys do
  @regions ["editor", "timeline", "stage"]
  @modifiers ["ctrl", "shift", "alt"]

  @named MapSet.new(
           ~w(return linefeed escape tab space backspace delete insert clear up down left right
              home end pageup pagedown kpdecimal kpdivide kpmultiply kpminus kpplus kpenter
              kpequal kpseparator kpleft kpright kpup kpdown kppageup kppagedown kphome kpend
              kpinsert kpdelete capslock scrolllock numlock printscreen pause menu) ++
             Enum.map(1..35, &"f#{&1}") ++ Enum.map(0..9, &"kp#{&1}")
         )

  def valid_action_id?(id), do: Regex.match?(~r/\A[a-z][a-z0-9_-]*\.[a-z0-9_.-]+\z/, id)

  defp layer(id) do
    case String.split(id, ".", parts: 2) do
      [prefix, _] when prefix in @regions -> prefix
      _ -> "global"
    end
  end

  defp character?(text), do: length(String.graphemes(text)) == 1

  @doc "`ctrl+shift+f`, `escape`, `kpenter`, `:`, `+`. Modifiers come first; the last part is the key."
  def parse(text) do
    plus = text == "+" or String.ends_with?(text, "++")
    parts = String.split(if(plus, do: String.slice(text, 0..-2//1), else: text), "+")
    {modifiers, [last]} = Enum.split(parts, -1)
    name = if plus and last == "", do: "+", else: last

    cond do
      name == "" ->
        {:error, "invalid key #{quoted(text)}"}

      Regex.match?(~r/\A[A-Z]\z/, name) ->
        {:error, "#{quoted(text)} names a capital letter; use shift+#{String.downcase(name)}"}

      not character?(name) and not MapSet.member?(@named, name) ->
        {:error, "unknown key name #{quoted(name)} in #{quoted(text)}"}

      true ->
        Enum.reduce_while(modifiers, {:ok, %{name: name}}, fn modifier, {:ok, chord} ->
          if modifier in @modifiers,
            do: {:cont, {:ok, Map.put(chord, String.to_atom(modifier), true)}},
            else: {:halt, {:error, "unknown modifier #{quoted(modifier)} in #{quoted(text)}"}}
        end)
    end
  end

  defp quoted(text), do: JSON.encode!(text)

  defp format(chord) do
    label =
      if utf16_length(chord.name) == 1,
        do: String.upcase(chord.name),
        else: String.upcase(String.first(chord.name)) <> String.slice(chord.name, 1..-1//1)

    [chord[:ctrl] && "Ctrl", chord[:alt] && "Alt", chord[:shift] && "Shift", label]
    |> Enum.filter(& &1)
    |> Enum.join("+")
  end

  defp utf16_length(text),
    do: div(byte_size(:unicode.characters_to_binary(text, :utf8, :utf16)), 2)

  defp chord_id(chord),
    do: "#{chord.name}|#{flag(chord[:ctrl])}|#{flag(chord[:shift])}|#{flag(chord[:alt])}"

  defp flag(true), do: 1
  defp flag(_), do: 0

  # A chord that types its own character: one visible character, without Ctrl or Alt.
  defp types_text?(chord),
    do: !chord[:ctrl] and !chord[:alt] and (chord.name == "space" or character?(chord.name))

  @doc """
  The chords of every action (`%{"id" => .., "keys" => [..]}`, in declaration order): its
  defaults unless `config` names it, with invalid and ambiguous bindings dropped. Returns the
  chords by action id and the diagnostics, `{level, text}`, in the order they were found.
  """
  def apply(actions, config) do
    {configured, diagnostics} = configured(config)
    known = MapSet.new(actions, & &1["id"])

    diagnostics =
      diagnostics ++
        for {id, _} <- configured,
            not MapSet.member?(known, id),
            do: {"warning", "keybindings: unknown action #{id}"}

    configured = Map.new(configured)

    {candidates, diagnostics} =
      Enum.reduce(actions, {[], diagnostics}, fn action, {candidates, diagnostics} ->
        id = action["id"]
        layer = layer(id)
        defaults = action["keys"] || []

        diagnostics =
          if layer == "global" and not Map.has_key?(configured, id) and defaults != [],
            do:
              diagnostics ++
                [{"warning", "keybindings: #{id} is global, so its default keys are not bound"}],
            else: diagnostics

        texts = Map.get(configured, id, if(layer == "global", do: [], else: defaults))

        Enum.reduce(texts, {candidates, diagnostics}, fn text, {candidates, diagnostics} ->
          case parse(text) do
            {:error, message} ->
              {candidates,
               diagnostics ++ [{"error", "keybindings: #{id}: #{message}; binding dropped"}]}

            {:ok, chord} ->
              if layer == "editor" and types_text?(chord),
                do:
                  {candidates,
                   diagnostics ++
                     [
                       {"error",
                        "keybindings: #{format(chord)} for #{id} types text in the editor; binding dropped"}
                     ]},
                else:
                  {candidates ++ [%{id: id, layer: layer, text: text, chord: chord}], diagnostics}
          end
        end)
      end)

    # Layers and their chords in the order they were first bound, each with its owners.
    tables =
      Enum.reduce(candidates, [], fn c, tables ->
        cid = chord_id(c.chord)
        table = List.keyfind(tables, c.layer, 0, {c.layer, []}) |> elem(1)

        table =
          case List.keyfind(table, cid, 0) do
            nil ->
              table ++ [{cid, c.chord, [c.id]}]

            {_, chord, owners} ->
              List.keyreplace(table, cid, 0, {cid, chord, Enum.uniq(owners ++ [c.id])})
          end

        if List.keymember?(tables, c.layer, 0),
          do: List.keyreplace(tables, c.layer, 0, {c.layer, table}),
          else: tables ++ [{c.layer, table}]
      end)

    clashes =
      for {layer, table} <- tables,
          {cid, chord, owners} <- table,
          length(owners) > 1,
          do: {{layer, cid}, chord, owners}

    ambiguous = MapSet.new(clashes, &elem(&1, 0))

    diagnostics =
      diagnostics ++
        for {_, chord, owners} <- clashes do
          {"error",
           "keybindings: #{format(chord)} is bound to #{Enum.join(owners, " and ")}; those bindings are dropped"}
        end

    keys =
      Enum.reduce(candidates, Map.new(actions, &{&1["id"], []}), fn c, keys ->
        if MapSet.member?(ambiguous, {c.layer, chord_id(c.chord)}),
          do: keys,
          else: Map.update!(keys, c.id, &(&1 ++ [c.text]))
      end)

    global = tables |> List.keyfind("global", 0, {"global", []}) |> elem(1)

    diagnostics =
      diagnostics ++
        for {layer, table} <- tables,
            layer != "global",
            {cid, chord, owners} <- table,
            {_, _, shadow} <- [List.keyfind(global, cid, 0)],
            not MapSet.member?(ambiguous, {"global", cid}),
            not MapSet.member?(ambiguous, {layer, cid}) do
          {"warning",
           "keybindings: global #{hd(shadow)} takes #{format(chord)} before #{hd(owners)}"}
        end

    {keys, diagnostics}
  end

  defp configured(nil), do: {[], []}

  defp configured(config) when is_map(config) do
    config
    |> Enum.sort()
    |> Enum.reduce({[], []}, fn {id, value}, {configured, diagnostics} ->
      chords = if is_binary(value), do: [value], else: value

      if is_list(chords) and Enum.all?(chords, &is_binary/1),
        do: {configured ++ [{id, chords}], diagnostics},
        else:
          {configured,
           diagnostics ++
             [{"error", "keybindings: #{id} must be a key or a list of keys; ignored"}]}
    end)
  end

  defp configured(_),
    do: {[], [{"error", "keybindings: expected an object of action ids"}]}
end
