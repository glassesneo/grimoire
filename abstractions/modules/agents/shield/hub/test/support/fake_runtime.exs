# A stand-in for the keel runtime that speaks its wire: it numbers its own events, answers
# snapshot requests with the last number, and refuses the `write` action unless the
# connection it was told about may write. `emit` publishes one event; `crash` exits.
defmodule FakeRuntime do
  def loop(s) do
    case IO.read(:stdio, :line) do
      :eof ->
        :ok

      line ->
        s = handle(JSON.decode!(line), s)
        loop(s)
    end
  end

  defp out(record), do: IO.write(JSON.encode!(record) <> "\n")

  defp handle(%{"type" => "writer", "connection" => c}, s), do: %{s | writer: c}

  defp handle(%{"type" => "snapshot_request", "id" => id}, s) do
    out(%{
      "type" => "snapshot",
      "id" => id,
      "snapshot" => %{"runtimeInstance" => "fake", "seq" => s.seq, "state" => %{"n" => s.seq}}
    })

    s
  end

  defp handle(%{"type" => "invoke", "id" => id, "connection" => c, "invoke" => invoke}, s) do
    case invoke["action"] do
      "write" when c != s.writer ->
        out(%{
          "type" => "result",
          "id" => id,
          "result" => %{"outcome" => "rejected", "code" => "not_writer"}
        })

        s

      "emit" ->
        seq = s.seq + 1
        out(%{"type" => "event", "event" => %{"runtimeInstance" => "fake", "seq" => seq}})

        out(%{
          "type" => "result",
          "id" => id,
          "result" => %{"outcome" => "done", "appliedSeq" => seq}
        })

        %{s | seq: seq}

      "crash" ->
        System.halt(3)

      "silent" ->
        s

      _ ->
        out(%{"type" => "result", "id" => id, "result" => %{"outcome" => "done", "detail" => c}})
        s
    end
  end
end

IO.write(
  JSON.encode!(%{"type" => "ready", "runtimeInstance" => "fake", "sessionId" => "s"}) <> "\n"
)

FakeRuntime.loop(%{writer: nil, seq: 0})
