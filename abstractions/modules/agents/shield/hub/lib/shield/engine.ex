# An engine is the protocol of one kind of agent process. It validates a launch request and
# keeps the process's protocol state as a pure state machine: process output and client
# requests become a new state and a list of effects. Shield.Agent owns the OS process and
# performs the effects, so an engine never sends, spawns, or blocks.
#
# Effects:
#   {:write, record}                      a record for the process's stdin
#   {:broadcast, record} | {:broadcast, record, observed_at}
#                                         an event for every subscriber, in sequence
#   {:subscribe, ref, request}            send the snapshot, then subscribe the client
#   {:reply, ref, request, result}        the process's answer to a client request
#   {:ok, ref, request, payload} | {:error, ref, request, code}
#   {:transaction, state, effects, ref, request, payload}
#                                         run `effects`; on success adopt `state` and reply
#   {:ready} | {:fail, code}              the agent's lifecycle
defmodule Shield.Engine do
  @type state :: term()
  @type effect :: tuple()
  @type ref :: %{pid: pid()}

  @doc "The client harnesses that may attach to this engine's agents."
  @callback harnesses() :: [String.t()]
  @doc "Validates attach options for a new agent; the launch carries what `init/1` needs."
  @callback launch(options :: map(), cwd :: String.t()) ::
              {:ok, launch :: map()} | {:error, String.t()}
  @callback init(launch :: map()) :: {state(), [effect()]}
  @doc "The view a new subscriber starts from."
  @callback snapshot(state()) :: map()
  @callback attach(state(), ref(), request :: map(), options :: map()) :: {state(), [effect()]}
  @callback input(state(), ref(), request :: map(), now :: integer()) :: {state(), [effect()]}
  @callback output(state(), record :: map(), now :: integer()) :: {state(), [effect()]}
  @callback expire(state(), now :: integer()) :: {state(), [effect()]}
  @doc "A client went away; its unresolved requests must not be answered."
  @callback detach(state(), pid()) :: state()
  @doc "The Agent could not write the record with this id."
  @callback reject_write(state(), id :: String.t()) :: {state(), [effect()]}
  @doc "The process ended or the agent failed; unresolved requests are answered with `reason`."
  @callback failed(state(), reason :: String.t()) :: {state(), [effect()]}

  @engines %{"pi" => Shield.Pi}
  @default "pi"

  @doc "The engine a request that names none means."
  def default, do: @default

  @doc "The engine module for a request's `engine` field."
  def fetch(nil), do: fetch(@default)
  def fetch(name), do: Map.fetch(@engines, name)

  def known?(name), do: name == nil or Map.has_key?(@engines, name)
end
