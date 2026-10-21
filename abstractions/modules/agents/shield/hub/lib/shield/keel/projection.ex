# Entries as the items screens show: a response split into its thinking, prose, and fenced
# code; a tool with the calls it made, and calls those made, summarized under it, each such
# call also an item of its own after its parent. Nothing is invented: what the driver did not
# supply stays absent. Tool arguments, results' details, and decorators' extras are carried
# without being interpreted.
#
# `publish/3` keeps item ids stable and gives an item a new version, from one counter, only
# when anything else in it changed; it reports the changed items and, when it changed, the
# order. Only entries that changed, or whose calls did, are projected again. Item text
# summarizes tool arguments in the order the decoded object lists its keys, which for the
# hub's maps is sorted by key.
defmodule Shield.Keel.Projection do
  alias Shield.Keel.Fences

  # `cache` holds each entry's published items, with their versions, under the key they were
  # projected for; `order` the item ids as last published; `fences` the fence splitting of
  # responses still streaming, by entry and part, so an update reads only the new lines.
  defstruct cache: %{}, order: [], version: 0, fences: %{}

  @doc """
  Publishes `entries`, in order, each as `{entry, stamp}`, where `stamp` grows, on one counter
  for all entries, whenever the entry changes. `reordered` says whether the entries' order may
  have changed. Returns the new projection, the changed items in order, and the complete new
  order of item ids, or nil when it did not change.
  """
  def publish(p, entries, reordered) do
    latest = subtree_stamps(entries)

    {p, changed, _, moved} =
      Enum.reduce(entries, {p, [], nil, reordered}, fn {entry, stamp},
                                                       {p, changed, children, moved} ->
        id = entry["id"]
        tool? = entry["kind"] == "tool"
        key = if entry["kind"] == "tool", do: {stamp, latest[id]}, else: stamp

        # A new order may change which calls a tool shows, and in what order.
        case p.cache[id] do
          %{key: ^key} when not (reordered and tool?) ->
            {p, changed, children, moved}

          old ->
            children = children || children(entries)
            calls = if entry["kind"] == "tool", do: descendants(children, id), else: []

            {items, fences} =
              if entry["kind"] == "assistant",
                do: response(entry, p.fences),
                else: {project(entry, calls), p.fences}

            old_items = if old, do: old.items, else: []
            {items, changed, version} = version(items, old_items, changed, p.version)
            cache = Map.put(p.cache, id, %{key: key, items: items})
            moved = moved or Enum.map(items, & &1["id"]) != Enum.map(old_items, & &1["id"])
            {%{p | cache: cache, fences: fences, version: version}, changed, children, moved}
        end
      end)

    ids = if moved, do: entries |> items(p) |> Enum.map(& &1["id"]), else: p.order
    order = if ids == p.order, do: nil, else: ids
    {%{p | order: ids}, Enum.reverse(changed), order}
  end

  @doc "Every item of `entries`, in order, as last published."
  def items(entries, p),
    do: Enum.flat_map(entries, fn {entry, _} -> p.cache[entry["id"]].items end)

  # An item keeps its version unless anything else in it changed.
  defp version(items, old_items, changed, version) do
    old = Map.new(old_items, &{&1["id"], &1})

    {items, {changed, version}} =
      Enum.map_reduce(items, {changed, version}, fn item, {changed, version} ->
        with %{"version" => n} = before <- old[item["id"]],
             true <- before == Map.put(item, "version", n) do
          {before, {changed, version}}
        else
          _ ->
            versioned = Map.put(item, "version", version + 1)
            {versioned, {[versioned | changed], version + 1}}
        end
      end)

    {items, changed, version}
  end

  # Calls come after the tool that made them, so one pass from the end gives each entry the
  # latest stamp in its subtree, its own included.
  defp subtree_stamps(entries) do
    entries
    |> Enum.reverse()
    |> Enum.reduce(%{}, fn {entry, stamp}, latest ->
      own = max(stamp, Map.get(latest, entry["id"], stamp))
      latest = Map.put(latest, entry["id"], own)

      case entry do
        %{"kind" => "tool", "parentId" => parent} ->
          Map.update(latest, parent, own, &max(&1, own))

        _ ->
          latest
      end
    end)
  end

  defp children(entries) do
    entries
    |> Enum.reverse()
    |> Enum.reduce(%{}, fn
      {%{"kind" => "tool", "parentId" => parent} = entry, _}, acc ->
        Map.update(acc, parent, [entry], &[entry | &1])

      _, acc ->
        acc
    end)
  end

  defp descendants(children, id) do
    Enum.flat_map(Map.get(children, id, []), &[&1 | descendants(children, &1["id"])])
  end

  defp project(%{"kind" => "user"} = e, _) do
    attachments =
      if e["images"] == [], do: "", else: "\nattachments: " <> Enum.join(e["images"], "; ")

    [
      item(
        e["id"],
        "user",
        %{"text" => e["text"], "images" => e["images"]},
        "> " <> e["text"] <> attachments,
        source: nonempty(e["text"]),
        tone: "user"
      )
    ]
  end

  defp project(%{"kind" => "tool"} = e, calls), do: [tool(e, calls)]

  defp project(%{"kind" => "compaction"} = e, _) do
    label =
      %{
        "running" => "compacting…",
        "completed" => "compacted",
        "failed" => "compaction failed",
        "aborted" => "compaction aborted"
      }[e["state"]]

    head =
      label <>
        if(e["reason"], do: " (#{e["reason"]})", else: "") <>
        if(Map.has_key?(e, "tokensBefore"),
          do: " · #{number(e["tokensBefore"])} tokens before",
          else: ""
        )

    [
      item(e["id"], "compaction", data(e), join_present([head, e["errorMessage"], e["summary"]]),
        source: e["summary"] || e["errorMessage"],
        tone:
          case e["state"] do
            "failed" -> "error"
            "aborted" -> "warning"
            _ -> "dim"
          end
      )
    ]
  end

  defp project(%{"kind" => "retry"} = e, _) do
    state =
      %{
        "waiting" => "waiting to retry",
        "retrying" => "retrying…",
        "succeeded" => "succeeded",
        "failed" => "failed",
        "ended" => "ended"
      }[e["state"]]

    last =
      case List.last(e["attempts"]) do
        nil -> ""
        a -> " #{number(a["attempt"])}/#{number(a["maxAttempts"])}"
      end

    head =
      if(e["category"] == "summary", do: "summary retry", else: "retry") <> last <> " · " <> state

    attempts =
      Enum.map(e["attempts"], fn a ->
        "attempt #{number(a["attempt"])}/#{number(a["maxAttempts"])}: #{a["error"]}"
      end)

    [
      item(e["id"], "retry", data(e), join_present([head, e["finalError"] | attempts]),
        tone: if(e["state"] == "failed", do: "error", else: "warning")
      )
    ]
  end

  defp project(%{"kind" => "custom"} = e, _) do
    [
      item(e["id"], "custom", data(e), e["customType"] <> "\n" <> e["text"],
        source: e["text"],
        tone: "accent"
      )
    ]
  end

  defp project(%{"kind" => "config"} = e, _) do
    text = "── #{e["setting"]}: #{e["from"]} → #{e["to"]}"
    [item(e["id"], "config", data(e), text, source: text, tone: "dim")]
  end

  defp project(%{"kind" => "notice"} = e, _) do
    tone = if e["level"] == "info", do: "accent", else: e["level"]
    [item(e["id"], "notice", data(e), e["text"], source: e["text"], tone: tone)]
  end

  defp data(e), do: Map.drop(e, ["kind", "id", "version"])

  defp response(e, fences) do
    thinking = Enum.filter(e["parts"], &(&1["type"] == "thinking"))
    body = e["parts"] |> Enum.filter(&(&1["type"] == "text")) |> Enum.map_join("\n", & &1["text"])

    data =
      %{
        "thinking" =>
          thinking |> Enum.map(& &1["text"]) |> Enum.reject(&(&1 == "")) |> Enum.join("\n\n"),
        "hasThinking" => thinking != [],
        "thinkingWithheld" => thinking != [] and Enum.all?(thinking, & &1["withheld"]),
        "body" => body,
        "streaming" => e["streaming"]
      }
      |> put_present("stopReason", e["stopReason"])
      |> put_present("errorMessage", e["errorMessage"])

    text =
      case join_present([body, stop_text(data)]) do
        "" -> if data["hasThinking"], do: "thinking…", else: ""
        text -> text
      end

    parent =
      item(e["id"], "response", data, text,
        source: nonempty(body),
        tone:
          case data["stopReason"] do
            "error" -> "error"
            "aborted" -> "warning"
            _ -> nil
          end
      )

    {children, fences} =
      e["parts"]
      |> Enum.with_index()
      |> Enum.flat_map_reduce(fences, fn
        {%{"type" => "thinking"} = part, index}, fences ->
          {[
             item(
               "#{e["id"]}:thinking:#{index}",
               "thinking",
               %{"text" => part["text"], "withheld" => part["withheld"]},
               if(part["withheld"] or part["text"] == "",
                 do: "thinking withheld",
                 else: "thinking\n" <> part["text"]
               ),
               parent: e["id"],
               source: if(part["withheld"], do: nil, else: part["text"]),
               tone: "dim"
             )
           ], fences}

        {%{"type" => "text"} = part, index}, fences ->
          key = {e["id"], index}
          {blocks, state} = Fences.stream(part["text"], fences[key])
          # A finished response is split no more.
          fences =
            if e["streaming"], do: Map.put(fences, key, state), else: Map.delete(fences, key)

          blocks
          |> Enum.with_index()
          |> Enum.flat_map(fn {block, n} ->
            id = "#{e["id"]}:text:#{index}:part:#{n}"

            case block do
              # A blank run between fences has nothing to show; later ids stay stable.
              %{type: :text, text: text} ->
                if String.trim(text) == "",
                  do: [],
                  else: [
                    item(id, "prose", %{"text" => text, "streaming" => e["streaming"]}, text,
                      parent: e["id"],
                      source: text
                    )
                  ]

              %{type: :code} = code ->
                [
                  item(
                    id,
                    "code",
                    %{
                      "language" => code.language,
                      "body" => code.body,
                      "sourceText" => code.source_text,
                      "open" => code.open
                    },
                    code.source_text,
                    parent: e["id"],
                    source: code.source_text
                  )
                ]
            end
          end)
          |> then(&{&1, fences})
      end)

    {[parent | children], fences}
  end

  defp tool(e, calls) do
    data =
      %{
        "callId" => e["callId"],
        "name" => e["name"],
        "args" => e["args"],
        "state" => e["state"],
        "calls" =>
          Enum.map(calls, &%{"name" => &1["name"], "args" => &1["args"], "state" => &1["state"]})
      }
      |> put_present("result", e["result"])
      |> put_present("extra", e["extra"])

    result =
      case e["result"] do
        nil -> ""
        r -> join_present([r["text"] | Enum.map(r["images"], &"[image: #{&1}]")])
      end

    item(
      e["id"],
      "tool",
      data,
      "#{e["name"]} #{args_line(e["args"], 120)} · #{state_text(e["state"])}" <>
        if(result == "", do: "", else: "\n" <> result),
      variant: e["name"],
      parent: e["parentId"],
      source:
        case e["result"] do
          %{"partial" => false, "text" => text} -> nonempty(text)
          _ -> nil
        end,
      tone:
        case e["state"] do
          "error" -> "error"
          "unfinished" -> "warning"
          _ -> nil
        end
    )
  end

  defp item(id, kind, data, text, options) do
    %{"id" => id, "kind" => kind, "text" => text, "data" => data}
    |> put_present("variant", options[:variant])
    |> put_present("parentId", options[:parent])
    |> put_present("source", options[:source])
    |> put_present("tone", options[:tone])
  end

  defp put_present(map, _, nil), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)

  defp nonempty(""), do: nil
  defp nonempty(text), do: text

  defp join_present(parts), do: parts |> Enum.reject(&(&1 in [nil, ""])) |> Enum.join("\n")

  # How a finished response stopped, when that is worth saying.
  defp stop_text(%{"streaming" => true}), do: nil

  defp stop_text(%{"stopReason" => "error"} = d),
    do: "error: " <> (d["errorMessage"] || "the response failed")

  defp stop_text(%{"stopReason" => "aborted"} = d),
    do: if(d["errorMessage"], do: "aborted: " <> d["errorMessage"], else: "aborted")

  defp stop_text(%{"stopReason" => "length"}), do: "stopped at the output limit"
  defp stop_text(_), do: nil

  defp state_text(state),
    do:
      %{
        "pending" => "queued",
        "running" => "running…",
        "done" => "done",
        "error" => "failed",
        "unfinished" => "unfinished"
      }[state]

  # Arguments as `key=value` pairs, strings unquoted, on one line, cut at `limit` UTF-16 units.
  defp args_line(%{"available" => false}, _), do: "(arguments unavailable)"

  defp args_line(%{"value" => value}, limit) do
    line =
      case value do
        %{} = fields ->
          Enum.map_join(fields, " ", fn
            {key, field} when is_binary(field) -> "#{key}=#{field}"
            {key, field} -> "#{key}=#{compact(field)}"
          end)

        other ->
          compact(other)
      end
      |> String.replace(~r/\s*\n\s*/u, " ⏎ ")

    if utf16_length(line) > limit, do: utf16_take(line, limit - 1) <> "…", else: line
  end

  # A JSON value on one line, its whitespace collapsed.
  defp compact(value), do: value |> JSON.encode!() |> String.replace(~r/\s+/u, " ")

  defp utf16_length(text),
    do: div(byte_size(:unicode.characters_to_binary(text, :utf8, :utf16)), 2)

  defp utf16_take(text, units) do
    text
    |> String.to_charlist()
    |> Enum.reduce_while({[], 0}, fn c, {kept, n} ->
      width = if c > 0xFFFF, do: 2, else: 1
      if n + width > units, do: {:halt, {kept, n}}, else: {:cont, {[c | kept], n + width}}
    end)
    |> elem(0)
    |> Enum.reverse()
    |> List.to_string()
  end

  # A number as JavaScript writes it in text: an integral value without a fraction.
  defp number(n) when is_integer(n), do: Integer.to_string(n)
  defp number(n) when is_float(n) and n == trunc(n), do: Integer.to_string(trunc(n))
  defp number(n), do: Float.to_string(n)
end
