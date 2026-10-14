# Both transports split bytes on LF only. OTP's JSON implementation avoids Hex dependencies.
defmodule Shield.Protocol do
  @record_limit 64 * 1024 * 1024
  @live_limit 16 * 1024 * 1024
  def record_limit, do: @record_limit
  def live_limit, do: @live_limit
  def engine_request_limit, do: 4096
  def encode(value), do: JSON.encode!(value) <> "\n"

  def decode(line) do
    value = JSON.decode!(String.trim_trailing(line, "\r"))
    if is_map(value), do: value, else: raise(ArgumentError, "record must be an object")
  end

  def feed(buffer, bytes) do
    parts = :binary.split(buffer <> bytes, "\n", [:global])
    {lines, [tail]} = Enum.split(parts, -1)

    if byte_size(tail) > @record_limit or Enum.any?(lines, &(byte_size(&1) > @record_limit)),
      do: raise(ArgumentError, "frame_limit")

    {Enum.map(lines, &decode/1), tail}
  end

  def envelope(type, agent \\ nil),
    do: %{"v" => 1, "type" => type, "agent-id" => agent, "engine" => "pi"}

  def response(id, agent, payload),
    do:
      Map.merge(envelope("response", agent), %{
        "id" => id,
        "success" => true,
        "payload" => payload
      })

  def error(id, agent, code),
    do:
      Map.merge(envelope("response", agent), %{
        "id" => id,
        "success" => false,
        "error" => %{"code" => code}
      })

  def valid?(r),
    do:
      r["v"] == 1 and r["engine"] in [nil, "pi"] and Map.has_key?(r, "agent-id") and
        is_binary(r["id"]) and r["type"] in ["hub_request", "engine_request"] and
        is_map(r["payload"])
end
