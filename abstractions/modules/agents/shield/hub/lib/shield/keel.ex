# The keel runtime as an engine. The runtime owns a Pi session and all of its meaning; this
# module only launches it, correlates requests with its answers, and relays its records.
#
# Launch options: "configDir", an absolute directory the runtime reads its configuration
# from, and "launch", the runtime's descriptor. The runtime starts with the hub's environment
# cleared and the descriptor's applied, in the requested cwd, and with `--config-dir`
# appended. An agent serves one configuration directory; attaching with another is refused.
#
# Client requests (engine_request payloads):
#   {"op": "invoke", "action": id, "args": any, "writerEpoch": n}
#                                                 run an action; answered with the runtime's
#                                                 result, whose own outcome may be a refusal.
#                                                 `writerEpoch` is the writer epoch the client
#                                                 last saw, for the runtime to check
#   {"op": "snapshot"}                            resubscribe from a new snapshot, after a gap
# A request the runtime has not answered within 60 s is answered `acceptance_unknown` and is
# never resent; a late answer is dropped.
defmodule Shield.Keel do
  @behaviour Shield.Engine

  # Requests awaiting the runtime's answer, attaches waiting for readiness included.
  @request_limit 4096
  @deadline 60_000

  def harnesses, do: ["keel"]

  def launch(options, cwd, _identity) do
    d = options["launch"]
    config = options["configDir"]

    cond do
      not is_binary(config) or Path.type(config) != :absolute or not File.dir?(config) ->
        {:error, "invalid_config_dir"}

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
        argv = d["argv"] ++ ["--config-dir", config]

        {:ok,
         %{
           descriptor: d |> Map.put("env", env) |> Map.put("argv", argv),
           cwd: cwd,
           config_dir: config
         }}
    end
  end

  defp safe_string(s), do: is_binary(s) and not String.contains?(s, <<0>>)

  def init(launch),
    do: {%{config_dir: launch.config_dir, ready: false, next: 0, pending: %{}, attaches: []}, []}

  def attach(s, ref, request, options) do
    cond do
      options["configDir"] != s.config_dir ->
        {s, [{:error, ref, request, "config_dir_mismatch"}]}

      map_size(s.pending) + length(s.attaches) >= @request_limit ->
        {s, [{:error, ref, request, "engine_request_limit"}]}

      not s.ready ->
        {%{s | attaches: s.attaches ++ [{ref, request}]}, []}

      true ->
        subscribe(s, ref, request)
    end
  end

  defp subscribe(s, ref, request) do
    {s, id} = correlate(s, {:snapshot, ref, request})
    {s, [{:subscribe, ref}, {:write, %{"type" => "snapshot_request", "id" => id}}]}
  end

  def input(s, ref, request, _now) do
    p = request["payload"]

    cond do
      map_size(s.pending) >= @request_limit ->
        {s, [{:error, ref, request, "engine_request_limit"}]}

      p["op"] == "snapshot" ->
        subscribe(s, ref, request)

      p["op"] == "invoke" and is_binary(p["action"]) ->
        {s, id} = correlate(s, {:invoke, ref, request})

        invoke =
          p
          |> Map.take(["action", "args", "writerEpoch"])
          |> Map.reject(fn {k, v} -> k == "writerEpoch" and not is_integer(v) end)

        {s,
         [
           {:write, %{"type" => "invoke", "id" => id, "connection" => ref.id, "invoke" => invoke}}
         ]}

      true ->
        {s, [{:error, ref, request, "unsupported_operation"}]}
    end
  end

  defp correlate(s, kind) do
    id = "keel:" <> Integer.to_string(s.next)
    deadline = System.monotonic_time(:millisecond) + @deadline
    {%{s | next: s.next + 1, pending: Map.put(s.pending, id, {kind, deadline})}, id}
  end

  def output(s, %{"type" => "ready"}, _now) do
    if s.ready do
      {s, [{:fail, "invalid_runtime_record"}]}
    else
      Enum.reduce(s.attaches, {%{s | ready: true, attaches: []}, [{:ready}]}, fn {ref, r},
                                                                                 {s, effects} ->
        {s, next} = subscribe(s, ref, r)
        {s, effects ++ next}
      end)
    end
  end

  def output(s, %{"type" => "event", "event" => event}, _now) when is_map(event),
    do: {s, [{:broadcast, event}]}

  def output(s, %{"type" => "fail", "code" => code}, _now) when is_binary(code),
    do: {s, [{:fail, code}]}

  def output(s, %{"type" => type, "id" => id} = r, _now)
      when type in ["snapshot", "snapshot_error", "result"] and is_binary(id) do
    case Map.pop(s.pending, id) do
      {nil, _} ->
        # A request that timed out is never resent; its late answer is dropped.
        if String.starts_with?(id, "keel:"),
          do: {s, []},
          else: {s, [{:fail, "uncorrelated_runtime_record"}]}

      {{kind, _}, pending} ->
        {%{s | pending: pending}, answer(kind, r)}
    end
  end

  def output(s, _record, _now), do: {s, [{:fail, "invalid_runtime_record"}]}

  defp answer({:snapshot, ref, request}, %{"type" => "snapshot", "snapshot" => snapshot})
       when is_map(snapshot),
       do: [{:snapshot, ref, request, snapshot}]

  defp answer({:snapshot, ref, request}, %{"type" => "snapshot_error", "code" => code})
       when is_binary(code),
       do: [{:error, ref, request, code}]

  defp answer({:invoke, ref, request}, %{"type" => "result", "result" => result})
       when is_map(result),
       do: [{:ok, ref, request, result}]

  defp answer({:detached, _}, _), do: []
  defp answer(_, _), do: [{:fail, "invalid_runtime_record"}]

  def writer(s, connection, epoch),
    do: {s, [{:write, %{"type" => "writer", "connection" => connection, "epoch" => epoch}}]}

  def expire(s, _now) do
    now = System.monotonic_time(:millisecond)
    {expired, pending} = Map.split_with(s.pending, fn {_, {_, deadline}} -> deadline <= now end)

    {%{s | pending: pending},
     Enum.flat_map(expired, fn {_, {kind, _}} -> unanswered(kind, "acceptance_unknown") end)}
  end

  def detach(s, pid) do
    pending =
      Map.new(s.pending, fn {id, {kind, deadline}} ->
        kind =
          case kind do
            {k, %{pid: ^pid}, _} -> {:detached, k}
            _ -> kind
          end

        {id, {kind, deadline}}
      end)

    %{s | pending: pending, attaches: Enum.reject(s.attaches, fn {ref, _} -> ref.pid == pid end)}
  end

  def reject_write(s, id) do
    case Map.pop(s.pending, id) do
      {nil, _} -> {s, []}
      {{kind, _}, pending} -> {%{s | pending: pending}, unanswered(kind, "engine_write_rejected")}
    end
  end

  def failed(s, reason) do
    effects =
      Enum.flat_map(s.pending, fn {_, {kind, _}} ->
        unanswered(
          kind,
          if(match?({:invoke, _, _}, kind), do: "acceptance_unknown", else: reason)
        )
      end) ++ Enum.map(s.attaches, fn {ref, r} -> {:error, ref, r, reason} end)

    {%{s | pending: %{}, attaches: []}, effects}
  end

  defp unanswered({_, ref, request}, code), do: [{:error, ref, request, code}]
  defp unanswered(_, _), do: []
end
