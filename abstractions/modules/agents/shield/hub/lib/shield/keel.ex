# keel as an engine. The agent's process is the keel driver, which runs one Pi session and the
# extensions' code; keel's model (Shield.Keel.Model) lives here and owns every piece of state
# keel's screens show. This module launches the driver, validates every record it receives
# against the keel contract (contracts/keel.tsp), and connects the model to the Agent's
# effects. The records themselves are specified by the contract and the model.
#
# Launch options (the contract's AttachOptions): "configDir", an absolute directory the driver
# reads its configuration from, and "launch", the driver's descriptor. The driver starts with
# the hub's environment cleared and the descriptor's applied, in the requested cwd, and with
# `--config-dir` appended. An agent serves one configuration directory; attaching with another
# is refused.
#
# A screen's request that does not conform is refused with `invalid_request`; a driver record
# that does not conform fails the agent with `invalid_runtime_record`. Screens are served
# snapshots once the driver is ready; attaches before that wait for it.
defmodule Shield.Keel do
  @behaviour Shield.Engine
  alias Shield.Keel.{Contract, Model}

  # Attaches waiting for the driver to be ready.
  @attach_limit 4096

  def harnesses, do: ["keel"]

  def launch(options, cwd, _identity) do
    d = options["launch"]
    config = options["configDir"]

    cond do
      not is_binary(config) or Path.type(config) != :absolute or not File.dir?(config) ->
        {:error, "invalid_config_dir"}

      not Contract.valid?("AttachOptions", options) or Path.type(d["executable"]) != :absolute or
        not File.regular?(d["executable"]) or not Enum.all?(d["argv"], &safe_string/1) or
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

  # The model's deadlines follow a clock that a change of the wall clock does not move.
  defp now, do: System.monotonic_time(:millisecond)

  def init(launch) do
    instance = Base.encode16(:crypto.strong_rand_bytes(8), case: :lower)
    {%{config_dir: launch.config_dir, model: Model.new(instance), attaches: []}, []}
  end

  def attach(s, ref, request, options) do
    cond do
      options["configDir"] != s.config_dir ->
        {s, [{:error, ref, request, "config_dir_mismatch"}]}

      not s.model.ready and length(s.attaches) >= @attach_limit ->
        {s, [{:error, ref, request, "engine_request_limit"}]}

      not s.model.ready ->
        {%{s | attaches: s.attaches ++ [{ref, request}]}, []}

      true ->
        {s, subscribe(s, ref, request)}
    end
  end

  defp subscribe(s, ref, request),
    do: [{:subscribe, ref}, {:snapshot, ref, request, Model.snapshot(s.model)}]

  def input(s, ref, request, _now) do
    payload = request["payload"]

    cond do
      not Contract.valid?("ScreenRequest", payload) ->
        {s, [{:error, ref, request, "invalid_request"}]}

      payload["op"] == "snapshot" ->
        {s, subscribe(s, ref, request)}

      true ->
        s
        |> step(Model.invoke(s.model, {ref, request}, ref.id, payload, now()))
    end
  end

  def output(s, record, _now) do
    if Contract.valid?("DriverRecord", record),
      do: step(s, Model.driver_record(s.model, record, now())),
      else: {s, [{:fail, "invalid_runtime_record"}]}
  end

  def writer(s, connection, epoch),
    do: {%{s | model: Model.writer(s.model, connection, epoch)}, []}

  def expire(s, _now), do: step(s, Model.expire(s.model, now()))

  def detach(s, pid) do
    model = Model.drop_clients(s.model, fn {ref, _} -> ref.pid == pid end)
    %{s | model: model, attaches: Enum.reject(s.attaches, fn {ref, _} -> ref.pid == pid end)}
  end

  def reject_write(s, id), do: step(s, Model.write_rejected(s.model, id))

  def failed(s, reason) do
    {s, effects} = step(s, Model.failed(s.model, reason))
    attaches = Enum.map(s.attaches, fn {ref, request} -> {:error, ref, request, reason} end)
    {%{s | attaches: []}, effects ++ attaches}
  end

  # The model's outputs as the Agent's effects. Readiness serves the waiting attaches after
  # the step's event, which their snapshots already include.
  defp step(s, {model, out}) do
    s = %{s | model: model}

    effects =
      Enum.map(out, fn
        {:instruct, record} -> {:write, record}
        {:reply, {ref, request}, result} -> {:ok, ref, request, result}
        other -> other
      end)

    if {:ready} in effects do
      subscribes = Enum.flat_map(s.attaches, fn {ref, request} -> subscribe(s, ref, request) end)
      {%{s | attaches: []}, effects ++ subscribes}
    else
      {s, effects}
    end
  end
end
