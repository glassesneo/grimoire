# Framing is the hub's own contract with both transports: records must not depend on how
# the bytes are chunked, and an oversized record is refused rather than truncated.
defmodule Shield.ProtocolTest do
  use ExUnit.Case, async: true
  alias Shield.Protocol

  # Records must not depend on how the transport chunks their bytes.
  defp feed_all(bytes, size) do
    {records, buffer} =
      bytes
      |> chunks(size)
      |> Enum.reduce({[], Protocol.buffer()}, fn chunk, {all, buffer} ->
        {records, buffer} = Protocol.feed(buffer, chunk)
        {[records | all], buffer}
      end)

    {records |> Enum.reverse() |> List.flatten(), Protocol.buffered(buffer)}
  end

  defp chunks(<<>>, _), do: []

  defp chunks(bytes, size) when byte_size(bytes) <= size, do: [bytes]

  defp chunks(bytes, size) do
    <<chunk::binary-size(size), rest::binary>> = bytes
    [chunk | chunks(rest, size)]
  end

  test "framing yields the same records however the bytes are chunked" do
    records = [
      %{"text" => "日本\u2028語\u2029", "value" => nil},
      %{"empty" => ""},
      %{"large" => String.duplicate("x", 300_000)}
    ]

    bytes = Enum.map_join(records, &(Protocol.encode(&1) |> String.replace("\n", "\r\n")))

    for size <- [1, 2, 3, 7, 4096, 65_536, byte_size(bytes)] do
      assert feed_all(bytes, size) == {records, 0}
    end

    {[], held} = feed_all(binary_part(bytes, 0, 10), 3)
    assert held == 10
    assert_raise JSON.DecodeError, fn -> Protocol.feed(Protocol.buffer(), "not-json\n") end
  end

  test "framing rejects a record over the limit, however it is chunked" do
    over = :binary.copy("x", Protocol.record_limit() + 1)

    for size <- [65_536, byte_size(over)] do
      assert_raise ArgumentError, fn -> feed_all(over, size) end
      assert_raise ArgumentError, fn -> feed_all(over <> "\n", size) end
    end
  end
end
