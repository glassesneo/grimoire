# Both transports split bytes on LF only. OTP's JSON implementation avoids Hex dependencies.
# A record is at most 64 MiB; a connection may hold 64 unresolved requests and a 16 MiB live
# backlog, with snapshot bytes counted apart. A peer that exceeds the record or backlog limit,
# sends a line that is not a JSON object, or reuses the id of an unresolved request is
# disconnected, never silently truncated; a decodable record that is not a valid request gets
# an `invalid_protocol` response, and one past the request limit a `request_limit` response.
defmodule Shield.Protocol do
  @record_limit 64 * 1024 * 1024
  @live_limit 16 * 1024 * 1024
  def record_limit, do: @record_limit
  def live_limit, do: @live_limit
  def encode(value), do: JSON.encode!(value) <> "\n"

  def decode(line) do
    value = JSON.decode!(String.trim_trailing(line, "\r"))
    if is_map(value), do: value, else: raise(ArgumentError, "record must be an object")
  end

  @doc "The empty input buffer of `feed/2`."
  def buffer, do: {[], 0}

  @doc "Bytes held in a buffer until their record's LF arrives."
  def buffered({_, size}), do: size

  # Only the new bytes are searched for LF, and a partial record is kept as reversed
  # pieces until its LF arrives.
  def feed({pieces, size}, bytes) do
    case :binary.split(bytes, "\n", [:global]) do
      [partial] ->
        {[], {[partial | pieces], limit!(size + byte_size(partial))}}

      [first | rest] ->
        limit!(size + byte_size(first))
        {lines, [tail]} = Enum.split(rest, -1)
        Enum.each(lines, &limit!(byte_size(&1)))
        line = IO.iodata_to_binary(Enum.reverse([first | pieces]))
        {Enum.map([line | lines], &decode/1), {[tail], limit!(byte_size(tail))}}
    end
  end

  defp limit!(size) when size > @record_limit, do: raise(ArgumentError, "frame_limit")
  defp limit!(size), do: size

  def envelope(type, agent \\ nil, engine \\ nil),
    do: %{"v" => 1, "type" => type, "agent-id" => agent, "engine" => engine}

  def response(id, agent, engine, payload),
    do:
      Map.merge(envelope("response", agent, engine), %{
        "id" => id,
        "success" => true,
        "payload" => payload
      })

  def error(id, agent, engine, code),
    do:
      Map.merge(envelope("response", agent, engine), %{
        "id" => id,
        "success" => false,
        "error" => %{"code" => code}
      })

  def valid?(r),
    do:
      r["v"] == 1 and Shield.Engine.known?(r["engine"]) and Map.has_key?(r, "agent-id") and
        is_binary(r["id"]) and r["type"] in ["hub_request", "engine_request"] and
        is_map(r["payload"])
end
