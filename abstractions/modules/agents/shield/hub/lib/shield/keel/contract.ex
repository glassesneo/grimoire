# The keel contract (contracts/keel.tsp), read from its generated JSON Schema when this module
# compiles. A validator is built once per definition and kept for the hub's life. Validation
# only answers whether a value conforms: the value itself is used as received, never as the
# validator would cast it.
defmodule Shield.Keel.Contract do
  @path Path.expand("../../../../contracts/generated/keel.schema.json", __DIR__)
  @external_resource @path
  @defs JSON.decode!(File.read!(@path))["$defs"]

  @doc "Whether `value` conforms to the contract's definition `name`."
  def valid?(name, value) do
    match?({:ok, _}, JSV.validate(value, validator(name)))
  end

  defp validator(name) do
    key = {__MODULE__, name}

    case :persistent_term.get(key, nil) do
      nil ->
        root = %{"$defs" => @defs, "$ref" => "#/$defs/" <> name}

        {:ok, built} =
          JSV.build(root, default_meta: "https://json-schema.org/draft/2020-12/schema")

        :persistent_term.put(key, built)
        built

      built ->
        built
    end
  end
end
