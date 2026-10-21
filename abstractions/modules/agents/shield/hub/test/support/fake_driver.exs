# A stand-in for the keel driver that speaks its side of the keel contract: it declares the
# actions below, then reports itself ready, and runs them when the model says so. `write` needs
# the write right (the model checks it), `look` answers with the connection the model named,
# `emit` adds an entry, `silent` never answers, and `crash` exits.
defmodule FakeDriver do
  def loop(n) do
    case IO.read(:stdio, :line) do
      :eof ->
        :ok

      line ->
        loop(handle(JSON.decode!(line), n))
    end
  end

  def out(record), do: IO.write(JSON.encode!(record) <> "\n")

  defp handle(%{"type" => "run_action", "id" => id} = r, n) do
    case r["action"] do
      "fake.emit" ->
        out(%{
          "type" => "entries",
          "entries" => [
            %{
              "kind" => "notice",
              "id" => "notice-#{n}",
              "version" => 0,
              "level" => "info",
              "text" => "emitted"
            }
          ]
        })

        out(%{"type" => "result", "id" => id, "result" => %{"outcome" => "done"}})
        n + 1

      "fake.crash" ->
        System.halt(3)

      "fake.silent" ->
        n

      _ ->
        out(%{
          "type" => "result",
          "id" => id,
          "result" => %{"outcome" => "done", "detail" => r["connection"]}
        })

        n
    end
  end

  defp handle(_, n), do: n
end

FakeDriver.out(%{
  "type" => "operation",
  "id" => "declare",
  "operation" => %{
    "op" => "declare_actions",
    "actions" =>
      [%{"id" => "fake.write", "runs" => "driver"}] ++
        for(
          id <- ~w(fake.look fake.emit fake.silent fake.crash),
          do: %{"id" => id, "class" => "control", "runs" => "driver"}
        )
  }
})

FakeDriver.out(%{
  "type" => "ready",
  "session" => %{"id" => "s", "cwd" => File.cwd!(), "model" => nil, "thinking" => nil}
})

FakeDriver.loop(0)
