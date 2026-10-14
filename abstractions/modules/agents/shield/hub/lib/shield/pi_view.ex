defmodule Shield.PiView do
  def new do
    %{
      "schema" => "quin-pi-view/1",
      "session" => %{},
      "timeline" => %{
        "entries" => [],
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

  def state(v, data) do
    model = data["model"]
    name = if is_map(model), do: model["provider"] <> "/" <> model["id"], else: nil

    v
    |> Map.put("session", Map.take(data, ["sessionId", "sessionFile", "model", "thinkingLevel"]))
    |> put_in(["timeline", "model"], name)
    |> put_in(["timeline", "thinking"], data["thinkingLevel"])
  end

  def seed(v, data) do
    by_id = Map.new(data["entries"], &{&1["id"], &1})
    branch = branch(by_id, data["leafId"], MapSet.new())

    Enum.reduce(branch, v, fn e, v ->
      id = "seed:" <> e["id"]

      case e["type"] do
        "message" ->
          m = e["message"]

          case m["role"] do
            "user" -> append(v, user(id, m))
            "assistant" -> v |> put_in(["timeline", "response"], id) |> assistant(m, false)
            "toolResult" -> finish_result(v, m)
            _ -> v
          end

        "compaction" ->
          append(
            v,
            Map.merge(base(id, "compaction"), %{
              "state" => "completed",
              "summary" => e["summary"],
              "tokensBefore" => e["tokensBefore"]
            })
          )

        "custom_message" ->
          if e["display"],
            do:
              append(
                v,
                Map.merge(base(id, "custom"), Map.take(e, ["customType", "content", "details"]))
              ),
            else: v

        _ ->
          v
      end
    end)
    |> put_in(["timeline", "response"], nil)
  end

  defp branch(_, nil, _), do: []

  defp branch(entries, id, seen) do
    if MapSet.member?(seen, id), do: raise("invalid_entry_tree")

    case entries[id] do
      nil -> raise("missing_branch_entry")
      e -> branch(entries, e["parentId"], MapSet.put(seen, id)) ++ [e]
    end
  end

  def apply(v, r, now) do
    case r["type"] do
      "agent_start" ->
        put_in(v, ["run", "active"], true)

      "agent_settled" ->
        v =
          v
          |> put_in(["run", "active"], false)
          |> put_in(["run", "retry"], false)
          |> put_in(["timeline", "response"], nil)

        update_in(v, ["timeline", "entries"], fn entries ->
          Enum.map(entries, fn e ->
            cond do
              e["kind"] == "tool" and e["state"] in ["pending", "running"] ->
                bump(e, %{"state" => "unfinished"})

              e["kind"] == "assistant" and e["streaming"] ->
                bump(e, %{"streaming" => false})

              true ->
                e
            end
          end)
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
            if m["display"],
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
        Map.put(v, "queue", Map.take(r, ["steering", "followUp"]))

      "thinking_level_changed" ->
        v |> put_in(["session", "thinkingLevel"], r["level"]) |> config("thinking", r["level"])

      "session_info_changed" ->
        put_in(v, ["session", "sessionName"], r["name"])

      "compaction_start" ->
        v
        |> put_in(["run", "compaction"], true)
        |> new_entry("compaction", %{"state" => "running", "reason" => r["reason"]})

      "compaction_end" ->
        v
        |> put_in(["run", "compaction"], false)
        |> update_last(fn e -> e["kind"] == "compaction" and e["state"] == "running" end, fn e ->
          bump(
            e,
            Map.merge(r["result"] || %{}, %{
              "state" =>
                cond do
                  r["result"] -> "completed"
                  r["aborted"] -> "aborted"
                  true -> "failed"
                end,
              "errorMessage" => r["errorMessage"]
            })
          )
        end)

      type when type in ["auto_retry_start", "summarization_retry_scheduled"] ->
        v
        |> put_in(["run", "retry"], true)
        |> new_entry(
          "retry",
          Map.merge(Map.take(r, ["attempt", "maxAttempts", "delayMs", "errorMessage"]), %{
            "state" => "waiting"
          })
        )

      type when type in ["auto_retry_end", "summarization_retry_finished"] ->
        v
        |> put_in(["run", "retry"], false)
        |> update_last(
          &(&1["kind"] == "retry"),
          &bump(&1, %{
            "state" => if(r["success"] == false, do: "failed", else: "ended"),
            "finalError" => r["finalError"]
          })
        )

      "entry_appended" ->
        e = r["entry"]

        if e["type"] == "custom_message" and e["display"],
          do: new_entry(v, "custom", Map.take(e, ["customType", "content", "details"])),
          else: v

      "extension_ui_request" ->
        ui(v, r, now)

      "dialog_closed" ->
        update_in(v, ["dialogs"], &Map.delete(&1, r["id"]))

      "quin_run" ->
        Map.put(v, "run", r["run"])

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

      "setStatus" ->
        update_in(v, ["presentation", "status"], fn status ->
          if r["statusText"],
            do: Map.put(status, r["statusKey"], r["statusText"]),
            else: Map.delete(status, r["statusKey"])
        end)

      "setTitle" ->
        put_in(v, ["presentation", "title"], r["title"])

      "notify" ->
        new_entry(v, "notice", %{"level" => r["notifyType"] || "info", "text" => r["message"]})

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
                "text" => if(b["redacted"], do: "", else: b["thinking"]),
                "withheld" => !!b["redacted"]
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
        existing = Enum.find(v["timeline"]["entries"], &(&1["id"] == tool_id))

        args =
          if Map.has_key?(b, "arguments"),
            do: %{"available" => true, "value" => b["arguments"]},
            else: %{"available" => false}

        if existing do
          update_last(v, &(&1["id"] == tool_id), &bump(&1, %{"args" => args}))
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
        Enum.reverse(v["timeline"]["entries"]),
        &(&1["kind"] == "tool" and &1["callId"] == r["parentToolCallId"])
      )

    scope = if parent, do: parent["scope"], else: scope
    if is_nil(scope), do: raise("tool_without_scope")
    id = scope <> "/" <> r["toolCallId"]
    existing = Enum.find(v["timeline"]["entries"], &(&1["id"] == id))
    fields = %{"state" => "running", "args" => %{"available" => true, "value" => r["args"]}}

    if existing do
      update_last(v, &(&1["id"] == id), &bump(&1, fields))
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

  defp tool_update(v, r, partial) do
    result = r[if(partial, do: "partialResult", else: "result")]
    fields = %{"result" => result && Map.put(result, "partial", partial)}

    fields =
      if partial,
        do: fields,
        else: Map.put(fields, "state", if(r["isError"], do: "error", else: "done"))

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

    if before && before != value,
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

  defp append(v, e), do: update_in(v, ["timeline", "entries"], &(&1 ++ [e]))
  defp bump(e, fields), do: Map.merge(e, Map.put(fields, "version", e["version"] + 1))

  defp upsert(v, id, kind, fields) do
    if Enum.any?(v["timeline"]["entries"], &(&1["id"] == id)),
      do: update_last(v, &(&1["id"] == id), &bump(&1, fields)),
      else: append(v, Map.merge(base(id, kind), fields))
  end

  defp update_last(v, predicate, update) do
    entries = v["timeline"]["entries"]

    at =
      entries |> Enum.with_index() |> Enum.reverse() |> Enum.find(fn {e, _} -> predicate.(e) end)

    if at,
      do: put_in(v, ["timeline", "entries"], List.update_at(entries, elem(at, 1), update)),
      else: v
  end
end
