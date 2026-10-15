# The modules that serve every engine reach engines only through Shield.Engine. Reading the
# compiled atom tables catches calls, aliases, and module names held as data alike.
defmodule Shield.EngineNeutralityTest do
  use ExUnit.Case, async: true

  @neutral [Shield.Agent, Shield.Manager, Shield.Connection, Shield.Protocol]
  @shared [Shield.Engine, Shield.Listener]

  test "engine-neutral modules name no engine-side module" do
    :ok = with {:error, {:already_loaded, :shield}} <- Application.load(:shield), do: :ok
    engine_side = Application.spec(:shield, :modules) -- (@neutral ++ @shared)

    for module <- @neutral do
      {:ok, {^module, [atoms: atoms]}} = :beam_lib.chunks(:code.which(module), [:atoms])
      named = for {_, atom} <- atoms, atom in engine_side, do: atom
      assert named == [], "#{inspect(module)} names #{inspect(named)}"
    end
  end
end
