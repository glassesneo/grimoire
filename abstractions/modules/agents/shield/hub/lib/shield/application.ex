defmodule Shield.Application do
  use Application

  def start(_, _) do
    Supervisor.start_link(
      [
        {Registry, keys: :unique, name: Shield.Registry},
        {DynamicSupervisor, strategy: :one_for_one, name: Shield.Agents},
        Shield.Manager,
        Shield.Listener
      ],
      strategy: :one_for_one,
      max_restarts: 0,
      name: Shield.Supervisor
    )
  end
end
