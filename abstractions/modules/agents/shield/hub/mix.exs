defmodule Shield.MixProject do
  use Mix.Project

  def project,
    do: [
      app: :shield,
      version: "0.1.0",
      elixir: "~> 1.18",
      deps: [],
      elixirc_options: [warnings_as_errors: Mix.env() == :test],
      aliases: [test: "test --warnings-as-errors"],
      releases: [shield: [include_executables_for: [:unix]]]
    ]

  def application, do: [extra_applications: [:logger, :crypto], mod: {Shield.Application, []}]
end
