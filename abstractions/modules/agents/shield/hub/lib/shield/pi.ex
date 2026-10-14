# Pi-specific commands, correlation, initialization and transient view. No socket ownership.
defmodule Shield.Pi do
  @behaviour Shield.Engine
  alias Shield.PiView, as: View

  @reads ~w(get_state get_messages get_entries get_tree get_last_assistant_text get_available_models get_available_thinking_levels get_session_stats get_commands)
  @writes ~w(prompt steer follow_up abort clear_queue set_model set_thinking_level compact)
  @preflights ~w(prompt steer follow_up)
  def harnesses, do: ["quin"]

  def launch(options, cwd) do
    d = options["launch"]
    model = options["model"]

    cond do
      options["mode"] not in ["live", "mock"] ->
        {:error, "invalid_mode"}

      not is_binary(model) or not String.contains?(model, "/") ->
        {:error, "model_required"}

      not is_map(d) or not is_binary(d["executable"]) or Path.type(d["executable"]) != :absolute or
          not File.regular?(d["executable"]) ->
        {:error, "invalid_launch"}

      not is_list(d["argv"]) or not Enum.all?(d["argv"], &safe_string/1) or not is_map(d["env"]) or
          not Enum.all?(d["env"], fn {k, v} ->
            safe_string(k) and safe_string(v) and not String.contains?(k, "=")
          end) ->
        {:error, "invalid_launch"}

      true ->
        env = Map.new(System.get_env(), fn {key, _} -> {key, false} end) |> Map.merge(d["env"])

        env =
          if options["mode"] == "live",
            do: Map.merge(env, Map.take(System.get_env(), ~w(CMD_API_KEY COMMAND_CODE_API_KEY))),
            else: env

        {:ok,
         %{descriptor: Map.put(d, "env", env), cwd: cwd, model: model, mode: options["mode"]}}
    end
  end

  defp safe_string(s), do: is_binary(s) and not String.contains?(s, <<0>>)

  def init(launch) do
    s = %{
      view: View.new(),
      next: 0,
      pending: %{},
      initializing: true,
      seed: %{},
      model: launch.model,
      mode: launch.mode,
      attaches: [],
      interrupt: nil
    }

    Enum.reduce(~w(get_entries get_state get_available_models), {s, []}, fn command,
                                                                            {s, effects} ->
      {s, write} = rpc(s, %{"type" => command}, {:seed, command})
      {s, effects ++ write}
    end)
  end

  def snapshot(s), do: s.view

  def attach(s, ref, request, options) do
    cond do
      options["mode"] != s.mode ->
        {s, [{:error, ref, request, "harness_engine_mode_mismatch"}]}

      map_size(s.pending) + length(s.attaches) >= Shield.Protocol.engine_request_limit() ->
        {s, [{:error, ref, request, "engine_request_limit"}]}

      s.initializing ->
        {%{s | attaches: s.attaches ++ [{ref, request, options}]}, []}

      # A model chooses only a new root's model: any client can change it later.
      true ->
        {s, [{:subscribe, ref, request}]}
    end
  end

  def input(s, ref, request, now) do
    p = request["payload"]

    cond do
      s.initializing -> {s, [{:error, ref, request, "agent_starting"}]}
      p["op"] == "interrupt" -> interrupt(s, ref, request, now)
      p["op"] == "dialog_reply" -> dialog(s, ref, request, now)
      p["op"] == "rpc" -> command(s, ref, request, now)
      true -> {s, [{:error, ref, request, "unsupported_operation"}]}
    end
  end

  defp command(s, ref, request, now) do
    r = request["payload"]["record"]

    cond do
      not valid_command?(r) ->
        {s, [{:error, ref, request, "unsupported_or_invalid_rpc"}]}

      s.interrupt != nil and r["type"] in @writes ->
        {s, [{:error, ref, request, "interrupting"}]}

      map_size(s.pending) >= Shield.Protocol.engine_request_limit() ->
        {s, [{:error, ref, request, "engine_request_limit"}]}

      r["type"] == "abort" ->
        interrupt(s, ref, request, now)

      true ->
        r = Map.delete(r, "id")

        r =
          if r["type"] == "prompt" and
               (s.view["run"]["active"] or s.view["run"]["accepting"] > 0),
             do: Map.put(r, "streamingBehavior", "followUp"),
             else: r

        {s, effects} = rpc(s, r, {:client, ref, request, r["type"]})

        if r["type"] == "prompt" do
          run = Map.update!(s.view["run"], "accepting", &(&1 + 1))

          {put_in(s, [:view, "run"], run),
           effects ++ [{:broadcast, %{"type" => "quin_run", "run" => run}}]}
        else
          {s, effects}
        end
    end
  end

  defp valid_command?(r) when is_map(r) do
    command = r["type"]

    allowed =
      case command do
        c when c in @preflights -> ~w(type id message images streamingBehavior)
        "get_entries" -> ~w(type id since)
        "set_model" -> ~w(type id provider modelId)
        "set_thinking_level" -> ~w(type id level)
        "compact" -> ~w(type id customInstructions)
        _ -> ~w(type id)
      end

    fields = Enum.all?(Map.keys(r), &(&1 in allowed))

    arguments =
      case command do
        "set_model" -> is_binary(r["provider"]) and is_binary(r["modelId"])
        "set_thinking_level" -> is_binary(r["level"])
        "compact" -> is_nil(r["customInstructions"]) or is_binary(r["customInstructions"])
        _ -> true
      end

    message =
      command not in @preflights or
        (is_binary(r["message"]) and String.trim(r["message"]) != "" and
           not Regex.match?(~r/^\s*\/new(?:\s|$)/, r["message"]))

    images =
      is_nil(r["images"]) or
        (is_list(r["images"]) and
           Enum.all?(r["images"], fn image ->
             is_map(image) and image["type"] == "image" and is_binary(image["data"]) and
               is_binary(image["mimeType"])
           end))

    fields and arguments and message and images and command in (@reads ++ @writes) and
      r["streamingBehavior"] in [nil, "steer", "followUp"] and
      (is_nil(r["since"]) or is_binary(r["since"]))
  end

  defp valid_command?(_), do: false

  def output(s, %{"type" => "response", "id" => id} = r, now) do
    case Map.pop(s.pending, id) do
      {nil, _} ->
        # Timed-out/disconnected requests are never resent; late responses are harmless.
        if is_binary(id) and String.starts_with?(id, "shield:"),
          do: {s, []},
          else: {s, [{:fail, "uncorrelated_pi_response"}]}

      {{kind, _deadline}, pending} ->
        {s, effects} = response(%{s | pending: pending}, kind, r, now)
        {s, next} = advance_interrupt(s, now)
        {s, effects ++ next}
    end
  end

  def output(s, %{"type" => "response"}, _), do: {s, [{:fail, "invalid_pi_response"}]}

  def output(s, r, now) do
    if s.initializing and
         r["type"] in ~w(agent_start message_start message_end entry_appended queue_update) do
      {s, [{:fail, "initialization_not_idle"}]}
    else
      s = %{s | view: View.apply(s.view, r, now)}
      {s, cancellation} = cancel_interrupt_dialog(s, r, now)
      {s, [{:broadcast, r, now} | cancellation]}
    end
  end

  defp response(s, {:seed, command}, r, _) do
    if r["success"] != true do
      {s, [{:fail, "pi_initialization_failed"}]}
    else
      s = %{s | seed: Map.put(s.seed, command, r["data"])}

      if map_size(s.seed) == 3 do
        data = s.seed["get_state"]
        available = s.seed["get_available_models"]["models"]

        exact =
          is_map(data["model"]) and name(data["model"]) == s.model and
            Enum.any?(available, &(name(&1) == s.model))

        if exact and data["isStreaming"] == false and data["isCompacting"] == false and
             data["pendingMessageCount"] == 0 do
          s = %{
            s
            | view: s.view |> View.state(data) |> View.seed(s.seed["get_entries"]),
              initializing: false,
              seed: %{}
          }

          waiting = s.attaches
          s = %{s | attaches: []}

          Enum.reduce(waiting, {s, [{:ready}]}, fn {ref, r, o}, {s, effects} ->
            {s, next} = attach(s, ref, r, o)
            {s, effects ++ next}
          end)
        else
          {s, [{:fail, "model_unavailable_or_initialization_not_idle"}]}
        end
      else
        {s, []}
      end
    end
  end

  defp response(s, {:client, ref, request, command}, r, now) do
    {s, effects} = accepted_done(s, command, r, now)
    {s, [{:reply, ref, request, Map.put(r, "id", request["id"])} | effects]}
  end

  defp response(s, {:detached, command}, r, now), do: accepted_done(s, command, r, now)

  defp response(s, :interrupt_clear, r, _) do
    if r["success"] == true do
      s = put_in(s, [:interrupt, :phase], :abort)
      rpc(s, %{"type" => "abort"}, :interrupt_abort)
    else
      interrupt_done(s, r)
    end
  end

  defp response(s, :interrupt_abort, r, _), do: interrupt_done(s, r)

  defp accepted_done(s, command, r, now) do
    cond do
      command == "prompt" ->
        run = Map.update!(s.view["run"], "accepting", &max(0, &1 - 1))
        {put_in(s, [:view, "run"], run), [{:broadcast, %{"type" => "quin_run", "run" => run}}]}

      # Pi reports a model change only to the requester; every client's view follows it.
      command == "set_model" and r["success"] == true and is_map(r["data"]) ->
        record = %{"type" => "quin_model", "model" => r["data"]}
        {%{s | view: View.apply(s.view, record, now)}, [{:broadcast, record, now}]}

      true ->
        {s, []}
    end
  end

  defp interrupt_done(s, r) do
    %{ref: ref, request: request} = s.interrupt
    run = Map.put(s.view["run"], "interrupting", false)

    {%{s | interrupt: nil, view: Map.put(s.view, "run", run)},
     [
       {:reply, ref, request, Map.put(r, "id", request["id"])},
       {:broadcast, %{"type" => "quin_run", "run" => run}}
     ]}
  end

  defp interrupt(s, ref, request, now) do
    if s.interrupt do
      {s, [{:error, ref, request, "interrupting"}]}
    else
      run = Map.put(s.view["run"], "interrupting", true)

      s = %{
        s
        | interrupt: %{ref: ref, request: request, phase: :fence, deadline: monotonic() + 60_000},
          view: Map.put(s.view, "run", run)
      }

      {s, cancellation} = cancel_all_dialogs(s, now)
      {s, effects} = advance_interrupt(s, now)
      {s, [{:broadcast, %{"type" => "quin_run", "run" => run}} | cancellation ++ effects]}
    end
  end

  defp advance_interrupt(%{interrupt: %{phase: :fence}} = s, _now) do
    waiting =
      Enum.any?(s.pending, fn {_, {kind, _}} ->
        case kind do
          {:client, _, _, c} -> c in @preflights
          {:detached, c} -> c in @preflights
          _ -> false
        end
      end)

    if waiting do
      {s, []}
    else
      s = put_in(s, [:interrupt, :phase], :clear)
      rpc(s, %{"type" => "clear_queue"}, :interrupt_clear)
    end
  end

  defp advance_interrupt(s, _), do: {s, []}

  # A tool/hook can issue another standard dialog after an earlier cancellation
  # resumes it. Every dialog observed during every interrupt phase is cancelled
  # exactly once, independently of the fence's clear/abort advancement.
  defp cancel_interrupt_dialog(
         %{interrupt: interrupt} = s,
         %{"type" => "extension_ui_request", "method" => method, "id" => id},
         now
       )
       when not is_nil(interrupt) and method in ["select", "confirm", "input", "editor"] do
    close_dialog(s, id, %{"cancelled" => true}, now)
  end

  defp cancel_interrupt_dialog(s, _r, _now), do: {s, []}

  defp cancel_all_dialogs(s, now) do
    Enum.reduce(Map.keys(s.view["dialogs"]), {s, []}, fn id, {state, effects} ->
      {state, next} = close_dialog(state, id, %{"cancelled" => true}, now)
      {state, effects ++ next}
    end)
  end

  defp dialog(s, ref, request, now) do
    p = request["payload"]
    d = s.view["dialogs"][p["id"]]

    valid =
      d && (is_nil(d["expiresAt"]) or d["expiresAt"] > now) &&
        (p["cancelled"] == true or
           case d["method"] do
             "confirm" ->
               is_boolean(p["confirmed"])

             "select" ->
               is_list(d["options"]) and is_binary(p["value"]) and p["value"] in d["options"]

             _ ->
               is_binary(p["value"])
           end)

    if valid do
      {next, effects} =
        close_dialog(s, p["id"], Map.take(p, ["cancelled", "value", "confirmed"]), now)

      {s, [{:transaction, next, effects, ref, request, %{"observed" => true}}]}
    else
      {s, [{:error, ref, request, "dialog_closed_or_invalid"}]}
    end
  end

  defp close_dialog(s, id, reply, now) do
    r = %{"type" => "dialog_closed", "id" => id}

    {%{s | view: View.apply(s.view, r, now)},
     [
       {:write, Map.merge(reply, %{"type" => "extension_ui_response", "id" => id})},
       {:broadcast, r, now}
     ]}
  end

  def expire(s, now) do
    cond do
      s.interrupt && s.interrupt.deadline <= monotonic() ->
        {s, [{:fail, "interrupt_preflight_timeout"}]}

      Enum.any?(s.pending, fn {_, {kind, deadline}} ->
        deadline <= monotonic() and preflight?(kind)
      end) ->
        {s, [{:fail, "preflight_timeout_acceptance_unknown"}]}

      true ->
        {s, effects} =
          Enum.reduce(s.view["dialogs"], {s, []}, fn {id, d}, {s, effects} ->
            if d["expiresAt"] && d["expiresAt"] <= now do
              r = %{"type" => "dialog_closed", "id" => id}
              {%{s | view: View.apply(s.view, r, now)}, effects ++ [{:broadcast, r, now}]}
            else
              {s, effects}
            end
          end)

        expired = Enum.filter(s.pending, fn {_, {_, deadline}} -> deadline <= monotonic() end)

        {s, effects} =
          Enum.reduce(expired, {s, effects}, fn {id, {kind, _}}, {s, effects} ->
            {%{s | pending: Map.delete(s.pending, id)},
             effects ++ request_error(kind, "request_timeout_acceptance_unknown")}
          end)

        {s, next} = advance_interrupt(s, now)
        {s, effects ++ next}
    end
  end

  def detach(s, pid) do
    pending =
      Map.new(s.pending, fn {id, {kind, deadline}} ->
        kind =
          case kind do
            {:client, %{pid: ^pid}, _, c} -> {:detached, c}
            _ -> kind
          end

        {id, {kind, deadline}}
      end)

    %{
      s
      | pending: pending,
        attaches: Enum.reject(s.attaches, fn {ref, _, _} -> ref.pid == pid end)
    }
  end

  def reject_write(s, id) do
    case Map.pop(s.pending, id) do
      {nil, _} ->
        {s, []}

      {{kind, _}, pending} ->
        {%{s | pending: pending}, request_error(kind, "engine_write_rejected")}
    end
  end

  def failed(s, reason) do
    effects =
      Enum.flat_map(s.pending, fn {_, {kind, _}} ->
        request_error(kind, if(preflight?(kind), do: "acceptance_unknown", else: reason))
      end)

    effects = effects ++ Enum.map(s.attaches, fn {ref, r, _} -> {:error, ref, r, reason} end)

    effects =
      if s.interrupt,
        do: effects ++ [{:error, s.interrupt.ref, s.interrupt.request, "acceptance_unknown"}],
        else: effects

    {%{s | pending: %{}, attaches: [], interrupt: nil}, effects}
  end

  defp request_error({:client, ref, r, _}, code), do: [{:error, ref, r, code}]
  defp request_error(_, _), do: []
  defp preflight?({:client, _, _, c}), do: c in @preflights
  defp preflight?({:detached, c}), do: c in @preflights
  defp preflight?(_), do: false

  defp rpc(s, record, kind) do
    id = "shield:" <> Integer.to_string(s.next)

    {%{
       s
       | next: s.next + 1,
         pending: Map.put(s.pending, id, {kind, monotonic() + timeout(record)})
     }, [{:write, Map.put(record, "id", id)}]}
  end

  # Compaction summarizes the history with the model, which can take minutes.
  defp timeout(%{"type" => "compact"}), do: 600_000
  defp timeout(_), do: 60_000

  defp name(m), do: m["provider"] <> "/" <> m["id"]
  defp monotonic, do: System.monotonic_time(:millisecond)
end
