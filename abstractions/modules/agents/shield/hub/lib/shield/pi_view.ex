# The Pi view, from Pi's RPC JSON events rather than the SDK's session events: a
# `message_update` carries only its delta (`toolcall_start` adds the call's `id` and
# `toolName`), so the streamed message is rebuilt from deltas, and a tool call's raw argument
# JSON is kept in `stream.arguments` by content index until `toolcall_end` gives the parsed
# arguments.
#
# The hub alone reduces records. Entries are indexed by id, with newest-first order;
# snapshots expose chronological arrays (shield-pi-view/2). An event's `patch.entries`
# upserts complete entries by id, appending new ids in the supplied order; entries are never
# removed or reordered between snapshots. Optional `patch.timeline` replaces the timeline
# metadata, not its entries. Other supplied sections replace their entire previous value;
# omitted sections stay unchanged. Clients apply patches in envelope sequence without
# interpreting Pi records. A missing record field becomes null in the view.
defmodule Shield.PiView do
  @open_retry ~w(waiting retrying)

  def new do
    %{
      :order => [],
      :changed => [],
      "schema" => "shield-pi-view/2",
      "timeline" => %{
        "entries" => %{},
        "response" => nil,
        "nextOrdinal" => 0,
        "model" => nil,
        "thinking" => nil
      },
      "stream" => %{"message" => nil, "messageId" => nil, "arguments" => %{}},
      "nextId" => 0,
      "run" => %{
        "active" => false,
        "accepting" => 0,
        "interrupting" => false,
        "retry" => false,
        "compaction" => false
      },
      "queue" => %{"steering" => [], "followUp" => []},
      "dialogs" => %{},
      "presentation" => %{"status" => %{}, "title" => nil}
    }
  end

  def snapshot(v) do
    v
    |> Map.drop([:order, :changed])
    |> put_in(
      ["timeline", "entries"],
      Enum.map(Enum.reverse(v.order), &v["timeline"]["entries"][&1])
    )
  end

  def patch(before, after_view) do
    sections =
      for key <- ~w(stream nextId run queue dialogs presentation),
          before[key] != after_view[key],
          into: %{},
          do: {key, after_view[key]}

    timeline = Map.delete(after_view["timeline"], "entries")

    sections =
      if Map.delete(before["timeline"], "entries") == timeline,
        do: sections,
        else: Map.put(sections, "timeline", timeline)

    entries =
      after_view.changed
      |> Enum.reverse()
      |> Enum.uniq()
      |> Enum.map(&after_view["timeline"]["entries"][&1])

    Map.put(sections, "entries", entries)
  end

  def state(v, data) do
    model = data["model"]
    name = if is_map(model), do: model["provider"] <> "/" <> model["id"], else: nil

    v
    |> put_in(["timeline", "model"], name)
    |> put_in(["timeline", "thinking"], data["thinkingLevel"])
  end

  # The active branch as the harness restores it, apart from the harness's own display
  # records: nested calls come only from a tool result's bounded summary.
  def seed(v, data) do
    by_id = Map.new(data["entries"], &{&1["id"], &1})
    branch = branch(by_id, data["leafId"], MapSet.new(), [])

    {v, _} =
      Enum.reduce(branch, {v, %{}}, fn e, {v, config} ->
        id = "seed:" <> e["id"]

        case e["type"] do
          "message" ->
            {seed_message(v, id, e["message"]), config}

          "compaction" ->
            {append(
               v,
               Map.merge(base(id, "compaction"), %{
                 "state" => "completed",
                 "reason" => nil,
                 "summary" => e["summary"],
                 "tokensBefore" => e["tokensBefore"],
                 "errorMessage" => nil
               })
             ), config}

          "custom_message" ->
            if e["display"] == true,
              do:
                {append(
                   v,
                   Map.merge(
                     base(id, "custom"),
                     Map.take(e, ["customType", "content", "details"])
                   )
                 ), config},
              else: {v, config}

          "branch_summary" ->
            {append(v, Map.put(base(id, "branch-summary"), "summary", e["summary"])), config}

          "model_change" ->
            seed_config(v, config, id, "model", e["provider"] <> "/" <> e["modelId"])

          "thinking_level_change" ->
            seed_config(v, config, id, "thinking", e["thinkingLevel"])

          _ ->
            {v, config}
        end
      end)

    put_in(v, ["timeline", "response"], nil)
  end

  defp seed_message(v, id, m) do
    case m["role"] do
      "user" ->
        append(v, user(id, m))

      "assistant" ->
        v |> put_in(["timeline", "response"], id) |> assistant(m, false)

      "toolResult" ->
        v |> finish_result(m) |> seed_nested(m)

      "bashExecution" ->
        append(
          v,
          Map.merge(base(id, "bash"), %{
            "command" => m["command"],
            "output" => m["output"],
            "exitCode" => m["exitCode"],
            "cancelled" => m["cancelled"],
            "truncated" => m["truncated"],
            "fullOutputPath" => m["fullOutputPath"]
          })
        )

      _ ->
        v
    end
  end

  # A first value is the initial configuration, not a change.
  defp seed_config(v, config, id, key, value) do
    before = config[key]

    v =
      if not is_nil(before) and before != value,
        do:
          append(
            v,
            Map.merge(base(id, "config"), %{"setting" => key, "from" => before, "to" => value})
          ),
        else: v

    {v, Map.put(config, key, value)}
  end

  # A call's parent is named only through its id, `<parent>/<n>`; one whose parent is not
  # listed belongs to the root.
  defp seed_nested(v, m) do
    summary = m["nestedCalls"]

    root =
      Enum.find(
        entries(v),
        &(&1["kind"] == "tool" and is_nil(&1["parentId"]) and &1["callId"] == m["toolCallId"])
      )

    if is_nil(root) or not is_map(summary) or not is_list(summary["calls"]) do
      v
    else
      scope = root["scope"]
      calls = Enum.map(summary["calls"], & &1["id"])

      children =
        summary["calls"]
        |> Enum.with_index()
        |> Enum.map(fn {call, position} ->
          parent =
            case :binary.matches(call["id"], "/") do
              [] -> root["callId"]
              matches -> binary_part(call["id"], 0, elem(List.last(matches), 0))
            end

          parent = if parent in calls, do: scope <> "/" <> parent, else: root["id"]

          args =
            if is_nil(call["arguments"]),
              do: %{"available" => false, "bytes" => call["argumentsBytes"]},
              else: %{"available" => true, "value" => call["arguments"]}

          Map.merge(base(scope <> "/" <> call["id"], "tool"), %{
            "callId" => call["id"],
            "scope" => scope,
            "parentId" => parent,
            "name" => call["name"],
            "ordinal" => position,
            "args" => args,
            "state" =>
              case call["status"] do
                "ok" -> "done"
                "error" -> "error"
                _ -> "unfinished"
              end,
            "errorSummary" => call["error"],
            "nestedIncomplete" => false,
            "result" => nil
          })
        end)

      v
      |> update_entry(root["id"], &Map.put(&1, "nestedIncomplete", summary["complete"] != true))
      |> then(fn v -> Enum.reduce(children, v, &append(&2, &1)) end)
    end
  end

  # Walks from the leaf to the root, prepending, so the branch comes out root first.
  defp branch(_, nil, _, branch), do: branch

  defp branch(entries, id, seen, branch) do
    if MapSet.member?(seen, id), do: raise("invalid_entry_tree")

    case entries[id] do
      nil -> raise("missing_branch_entry")
      e -> branch(entries, e["parentId"], MapSet.put(seen, id), [e | branch])
    end
  end

  def apply(v, r, now) do
    v = %{v | changed: []}

    case r["type"] do
      "agent_start" ->
        v
        |> put_in(["run", "active"], true)
        |> update_retry("response", ["waiting"], &bump(&1, %{"state" => "retrying"}))

      "agent_settled" ->
        v =
          v
          |> put_in(["run", "active"], false)
          |> put_in(["run", "retry"], false)
          |> put_in(["timeline", "response"], nil)

        Enum.reduce(entries(v), v, fn e, v ->
          cond do
            e["kind"] == "tool" and e["state"] in ["pending", "running"] ->
              update_entry(v, e["id"], &bump(&1, %{"state" => "unfinished"}))

            e["kind"] == "assistant" and e["streaming"] ->
              update_entry(v, e["id"], &bump(&1, %{"streaming" => false}))

            true ->
              v
          end
        end)

      "message_start" ->
        m = r["message"]

        case m["role"] do
          "user" ->
            {id, v} = id(v)
            append(v, user(id, m))

          "assistant" ->
            {id, v} = id(v)

            v
            |> put_in(["timeline", "response"], id)
            |> put_in(["timeline", "nextOrdinal"], 0)
            |> Map.put("stream", %{"message" => m, "messageId" => id, "arguments" => %{}})
            |> assistant(m, true)

          _ ->
            v
        end

      "message_update" ->
        delta(v, r["assistantMessageEvent"])

      "message_end" ->
        m = r["message"]

        case m["role"] do
          "assistant" ->
            v |> put_in(["stream", "message"], m) |> assistant(m, false)

          "toolResult" ->
            finish_result(v, m)

          "custom" ->
            if m["display"] == true,
              do: new_entry(v, "custom", Map.take(m, ["customType", "content", "details"])),
              else: v

          _ ->
            v
        end

      "tool_execution_start" ->
        tool_start(v, r)

      "tool_execution_update" ->
        tool_update(v, r, true)

      "tool_execution_end" ->
        tool_update(v, r, false)

      "queue_update" ->
        Map.put(v, "queue", %{
          "steering" => r["steering"] || [],
          "followUp" => r["followUp"] || []
        })

      "thinking_level_changed" ->
        config(v, "thinking", r["level"])

      "compaction_start" ->
        v
        |> put_in(["run", "compaction"], true)
        |> new_entry("compaction", %{"state" => "running", "reason" => r["reason"]})

      # Pi ends a compaction it never started when overflow recovery fails again.
      "compaction_end" ->
        result = if is_map(r["result"]), do: r["result"], else: nil

        fields =
          Map.merge(result || %{}, %{
            "state" =>
              cond do
                result -> "completed"
                r["aborted"] == true -> "aborted"
                true -> "failed"
              end,
            "errorMessage" => r["errorMessage"]
          })

        running = &(&1["kind"] == "compaction" and &1["state"] == "running")
        v = put_in(v, ["run", "compaction"], false)

        if Enum.any?(entries(v), running),
          do: update_last(v, running, &bump(&1, fields)),
          else: new_entry(v, "compaction", Map.put(fields, "reason", r["reason"]))

      type when type in ["auto_retry_start", "summarization_retry_scheduled"] ->
        category = if type == "auto_retry_start", do: "response", else: "summary"

        attempt = %{
          "attempt" => r["attempt"],
          "maxAttempts" => r["maxAttempts"],
          "delayMs" => r["delayMs"],
          "error" => r["errorMessage"]
        }

        v = put_in(v, ["run", "retry"], true)

        if open_retry?(v, category),
          do:
            update_retry(v, category, @open_retry, fn e ->
              bump(e, %{"state" => "waiting", "attempts" => e["attempts"] ++ [attempt]})
            end),
          else:
            new_entry(v, "retry", %{
              "category" => category,
              "state" => "waiting",
              "attempts" => [attempt],
              "finalError" => nil
            })

      "summarization_retry_attempt_start" ->
        if open_retry?(v, "summary"),
          do: update_retry(v, "summary", @open_retry, &bump(&1, %{"state" => "retrying"})),
          else:
            new_entry(v, "retry", %{
              "category" => "summary",
              "state" => "retrying",
              "attempts" => [],
              "finalError" => nil
            })

      "summarization_retry_finished" ->
        v
        |> put_in(["run", "retry"], false)
        |> update_retry("summary", @open_retry, &bump(&1, %{"state" => "ended"}))

      "auto_retry_end" ->
        v
        |> put_in(["run", "retry"], false)
        |> update_retry(
          "response",
          @open_retry,
          &bump(&1, %{
            "state" => if(r["success"] == true, do: "succeeded", else: "failed"),
            "finalError" => r["finalError"]
          })
        )

      "entry_appended" ->
        e = r["entry"]

        if e["type"] == "custom_message" and e["display"] == true,
          do: new_entry(v, "custom", Map.take(e, ["customType", "content", "details"])),
          else: v

      "extension_ui_request" ->
        ui(v, r, now)

      "dialog_closed" ->
        update_in(v, ["dialogs"], &Map.delete(&1, r["id"]))

      "shield_run" ->
        Map.put(v, "run", r["run"])

      "shield_model" ->
        m = r["model"]
        config(v, "model", m["provider"] <> "/" <> m["id"])

      "extension_error" ->
        new_entry(v, "notice", %{"level" => "error", "text" => r["error"]})

      _ ->
        v
    end
  end

  defp ui(v, r, now) do
    case r["method"] do
      m when m in ["select", "confirm", "input", "editor"] ->
        expires =
          if is_number(r["timeout"]) and r["timeout"] != 0,
            do: now + max(0, r["timeout"]),
            else: nil

        put_in(v, ["dialogs", r["id"]], Map.put(r, "expiresAt", expires))

      # An empty status clears its key, as a missing one does.
      "setStatus" ->
        update_in(v, ["presentation", "status"], fn status ->
          if r["statusText"] in [nil, ""],
            do: Map.delete(status, r["statusKey"]),
            else: Map.put(status, r["statusKey"], r["statusText"])
        end)

      "setTitle" ->
        put_in(v, ["presentation", "title"], r["title"])

      "notify" ->
        level = if r["notifyType"] in [nil, ""], do: "info", else: r["notifyType"]
        new_entry(v, "notice", %{"level" => level, "text" => r["message"]})

      _ ->
        v
    end
  end

  defp delta(v, d) do
    m = v["stream"]["message"]
    if not is_map(m), do: raise("delta_without_message")
    index = d["contentIndex"]
    if not is_integer(index) or index < 0 or index > 100_000, do: raise("invalid_content_index")
    content = m["content"] || []
    content = content ++ List.duplicate(nil, max(0, index + 1 - length(content)))
    before = Enum.at(content, index) || %{}

    {block, v} =
      case d["type"] do
        "text_start" ->
          {%{"type" => "text", "text" => ""}, v}

        "thinking_start" ->
          {%{"type" => "thinking", "thinking" => ""}, v}

        "text_delta" ->
          {Map.merge(before, %{"type" => "text", "text" => (before["text"] || "") <> d["delta"]}),
           v}

        "thinking_delta" ->
          {Map.merge(before, %{
             "type" => "thinking",
             "thinking" => (before["thinking"] || "") <> d["delta"]
           }), v}

        "text_end" ->
          {%{"type" => "text", "text" => d["content"]}, v}

        "thinking_end" ->
          {Map.merge(before, %{"type" => "thinking", "thinking" => d["content"]}), v}

        "toolcall_start" ->
          {%{"type" => "toolCall", "id" => d["id"], "name" => d["toolName"]},
           put_in(v, ["stream", "arguments", Integer.to_string(index)], "")}

        "toolcall_delta" ->
          v =
            update_in(
              v,
              ["stream", "arguments", Integer.to_string(index)],
              &((&1 || "") <> d["delta"])
            )

          {before, v}

        "toolcall_end" ->
          {d["toolCall"], v}

        _ ->
          {before, v}
      end

    m = Map.put(m, "content", List.replace_at(content, index, block))
    v |> put_in(["stream", "message"], m) |> assistant(m, true)
  end

  defp assistant(v, m, streaming) do
    scope = v["timeline"]["response"]
    if is_nil(scope), do: raise("assistant_without_scope")

    parts =
      Enum.flat_map(m["content"] || [], fn b ->
        case b && b["type"] do
          "text" ->
            [%{"type" => "text", "text" => b["text"]}]

          "thinking" ->
            [
              %{
                "type" => "thinking",
                "text" => if(b["redacted"] == true, do: "", else: b["thinking"]),
                "withheld" => b["redacted"] == true
              }
            ]

          _ ->
            []
        end
      end)

    fields = %{
      "parts" => parts,
      "streaming" => streaming,
      "stopReason" => if(streaming, do: nil, else: m["stopReason"]),
      "errorMessage" => m["errorMessage"]
    }

    v = upsert(v, scope, "assistant", fields)

    Enum.reduce(m["content"] || [], v, fn b, v ->
      if b && b["type"] == "toolCall" do
        tool_id = scope <> "/" <> b["id"]
        existing = v["timeline"]["entries"][tool_id]

        args =
          if Map.has_key?(b, "arguments"),
            do: %{"available" => true, "value" => b["arguments"]},
            else: %{"available" => false}

        # Once Pi runs the call, its execution's arguments stand.
        if existing do
          if existing["state"] == "pending",
            do: update_entry(v, tool_id, &change(&1, %{"args" => args})),
            else: v
        else
          ordinal = v["timeline"]["nextOrdinal"]

          v
          |> put_in(["timeline", "nextOrdinal"], ordinal + 1)
          |> append(
            Map.merge(base(tool_id, "tool"), %{
              "callId" => b["id"],
              "scope" => scope,
              "parentId" => nil,
              "name" => b["name"],
              "ordinal" => ordinal,
              "args" => args,
              "state" => if(String.starts_with?(scope, "seed:"), do: "missing", else: "pending"),
              "nestedIncomplete" => false,
              "result" => nil
            })
          )
        end
      else
        v
      end
    end)
  end

  defp tool_start(v, r) do
    scope = v["timeline"]["response"]

    parent =
      Enum.find(
        entries(v),
        &(&1["kind"] == "tool" and &1["callId"] == r["parentToolCallId"])
      )

    scope = if parent, do: parent["scope"], else: scope
    if is_nil(scope), do: raise("tool_without_scope")
    id = scope <> "/" <> r["toolCallId"]
    existing = v["timeline"]["entries"][id]
    fields = %{"state" => "running", "args" => %{"available" => true, "value" => r["args"]}}

    if existing do
      update_entry(v, id, &bump(&1, fields))
    else
      ordinal = v["timeline"]["nextOrdinal"]

      v
      |> put_in(["timeline", "nextOrdinal"], ordinal + 1)
      |> append(
        Map.merge(
          base(id, "tool"),
          Map.merge(fields, %{
            "callId" => r["toolCallId"],
            "scope" => scope,
            "parentId" => if(parent, do: parent["id"], else: nil),
            "name" => r["toolName"],
            "ordinal" => ordinal,
            "nestedIncomplete" => false,
            "result" => nil
          })
        )
      )
    end
  end

  # Extension tools may return any value; a string or a list becomes the result's content,
  # and an update without a usable result changes nothing.
  defp tool_update(v, r, partial) do
    result =
      case r[if(partial, do: "partialResult", else: "result")] do
        text when is_binary(text) ->
          %{"content" => [%{"type" => "text", "text" => text}], "details" => nil}

        list when is_list(list) ->
          %{"content" => list, "details" => nil}

        map when is_map(map) ->
          map

        _ ->
          nil
      end

    fields = %{"result" => result && Map.put(result, "partial", partial)}

    fields =
      if partial,
        do: fields,
        else: Map.put(fields, "state", if(r["isError"] == true, do: "error", else: "done"))

    if partial and is_nil(result),
      do: v,
      else:
        update_last(
          v,
          &(&1["kind"] == "tool" and &1["callId"] == r["toolCallId"] and
              &1["parentId"] != nil == (r["parentToolCallId"] != nil)),
          &bump(&1, fields)
        )
  end

  defp finish_result(v, m),
    do:
      tool_update(
        v,
        %{
          "toolCallId" => m["toolCallId"],
          "result" => Map.take(m, ["content", "details"]),
          "isError" => m["isError"]
        },
        false
      )

  defp config(v, key, value) do
    before = v["timeline"][key]
    v = put_in(v, ["timeline", key], value)

    if not is_nil(before) and before != value,
      do: new_entry(v, "config", %{"setting" => key, "from" => before, "to" => value}),
      else: v
  end

  defp user(id, m),
    do:
      Map.merge(base(id, "user"), %{
        "text" => text(m["content"]),
        "images" =>
          if(is_list(m["content"]),
            do: Enum.filter(m["content"], &(&1["type"] == "image")),
            else: []
          )
      })

  defp text(c) when is_binary(c), do: c

  defp text(c) when is_list(c),
    do: c |> Enum.filter(&(&1["type"] == "text")) |> Enum.map_join("\n", & &1["text"])

  defp text(_), do: ""
  defp base(id, kind), do: %{"id" => id, "kind" => kind, "version" => 0}
  defp id(v), do: {"live:" <> Integer.to_string(v["nextId"]), Map.update!(v, "nextId", &(&1 + 1))}

  defp new_entry(v, kind, fields) do
    {id, v} = id(v)
    append(v, Map.merge(base(id, kind), fields))
  end

  defp entries(v), do: Stream.map(v.order, &v["timeline"]["entries"][&1])

  defp append(v, e) do
    v
    |> put_in(["timeline", "entries", e["id"]], e)
    |> Map.update!(:order, &[e["id"] | &1])
    |> Map.update!(:changed, &[e["id"] | &1])
  end

  defp update_entry(v, id, update) do
    before = v["timeline"]["entries"][id]
    after_entry = update.(before)

    if before == after_entry,
      do: v,
      else:
        v
        |> put_in(["timeline", "entries", id], after_entry)
        |> Map.update!(:changed, &[id | &1])
  end

  defp bump(e, fields), do: Map.merge(e, Map.put(fields, "version", e["version"] + 1))

  # A bump only when a field changes, so streamed deltas leave unchanged entries' versions.
  defp change(e, fields),
    do: if(Enum.all?(fields, fn {k, value} -> e[k] == value end), do: e, else: bump(e, fields))

  defp upsert(v, id, kind, fields) do
    if Map.has_key?(v["timeline"]["entries"], id),
      do: update_entry(v, id, &change(&1, fields)),
      else: append(v, Map.merge(base(id, kind), fields))
  end

  # One entry per retry sequence of a category, open while waiting or retrying, as the harness keeps them.
  defp retry?(e, category, states),
    do: e["kind"] == "retry" and e["category"] == category and e["state"] in states

  defp open_retry?(v, category),
    do: Enum.any?(entries(v), &retry?(&1, category, @open_retry))

  defp update_retry(v, category, states, update),
    do: update_last(v, &retry?(&1, category, states), update)

  defp update_last(v, predicate, update) do
    case Enum.find(entries(v), predicate) do
      nil -> v
      e -> update_entry(v, e["id"], update)
    end
  end
end
