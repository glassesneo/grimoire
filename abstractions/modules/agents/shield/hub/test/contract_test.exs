# The model's validator judges the shared cases (contracts/cases.json) as the screen's and the
# driver's TypeScript validator does; the Bun side checks the same file.
defmodule Shield.Keel.ContractTest do
  use ExUnit.Case, async: true
  alias Shield.Keel.Contract

  @cases Path.expand("../../contracts/cases.json", __DIR__)
         |> File.read!()
         |> JSON.decode!()
         |> Map.fetch!("cases")

  test "the shared cases are judged as the contract says" do
    for %{"definition" => definition, "valid" => valid, "value" => value} <- @cases do
      assert Contract.valid?(definition, value) == valid,
             "#{definition}: #{JSON.encode!(value)} should be #{if valid, do: "valid", else: "invalid"}"
    end
  end
end
