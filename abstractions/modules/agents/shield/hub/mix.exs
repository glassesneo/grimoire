defmodule Shield.MixProject do
  use Mix.Project

  def project,
    do: [
      app: :shield,
      version: "0.1.0",
      elixir: "~> 1.18",
      deps: [],
      releases: [shield: [include_executables_for: [:unix]]]
    ]

  def application, do: [extra_applications: [:logger, :crypto], mod: {Shield.Application, []}]
end
