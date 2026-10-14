# An engine is the protocol of one kind of agent process. It validates a launch request and
# keeps the process's protocol state as a pure state machine: process output and client
# requests become a new state and a list of effects. Shield.Agent owns the OS process and
# performs the effects, so an engine never sends, spawns, or blocks.
#
# The process is spawned from the launch's `descriptor`, a map of "executable" (an absolute
# path), "argv" (strings), and "env" (strings, where `false` unsets a variable), in the
# launch's `cwd`. It writes only LF-delimited JSON objects to stdout; anything else fails the
# agent with `invalid_engine_frame`, and its stderr goes to the hub's log. The Agent writes
# stdin in order and without blocking itself; a write that would queue more than one record's
# limit is rejected with `engine_stdin_busy`.
#
# Effects:
#   {:write, record}                      a record for the process's stdin
#   {:broadcast, record} | {:broadcast, record, observed_at}
#                                         an event for every subscriber, in sequence
#   {:subscribe, ref, request}            send the snapshot, then subscribe the client
#   {:ok, ref, request, payload}          a successful response
#   {:error, ref, request, code} | {:error, ref, request, code, payload}
#                                         an error response, with the engine's detail
#   {:transaction, state, effects, ref, request, payload}
#                                         run `effects`; on success adopt `state` and reply
#   {:ready} | {:fail, code}              the agent's lifecycle
#
# The Agent passes requests on only while the agent is ready, and answers the others with
# `agent_starting` or `agent_unavailable` itself; the Manager forwards to it until it ends.
defmodule Shield.Engine do
  @type state :: term()
  @type effect :: tuple()
  @type ref :: %{pid: pid()}

  @doc "The client harnesses that may attach to this engine's agents."
  @callback harnesses() :: [String.t()]
  @doc """
  Validates attach options for a new agent. The launch holds `descriptor` and `cwd` for the
  Agent, and whatever else `init/1` needs.
  """
  @callback launch(options :: map(), cwd :: String.t()) ::
              {:ok, launch :: %{descriptor: map(), cwd: String.t()}} | {:error, String.t()}
  @callback init(launch :: map()) :: {state(), [effect()]}
  @doc "The snapshot payload a new subscriber starts from, beside the Agent's `lifecycle`."
  @callback snapshot(state()) :: map()
  @doc "A client attaches to a running agent: options it cannot join are the engine's to refuse."
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

  @doc "The engine module registered under `name`."
  def fetch(name), do: Map.fetch(@engines, name)

  def known?(name), do: name == nil or Map.has_key?(@engines, name)
end
