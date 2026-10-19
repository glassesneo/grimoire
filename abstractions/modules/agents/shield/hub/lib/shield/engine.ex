# An engine is the protocol of one kind of agent process. It validates a launch request and
# keeps the process's protocol state as a pure state machine: process output and client
# requests become a new state and a list of effects. Shield.Agent owns the OS process, the
# subscribers, and the writer, and performs the effects, so an engine never sends, spawns,
# or blocks.
#
# The process is spawned from the launch's `descriptor`, a map of "executable" (an absolute
# path), "argv" (strings), and "env" (strings, where `false` unsets a variable), in the
# launch's `cwd`. It writes only LF-delimited JSON objects to stdout; anything else fails the
# agent with `invalid_engine_frame`, and its stderr goes to the hub's log. The Agent writes
# stdin in order and without blocking itself; a write that would queue more than one record's
# limit is rejected with `engine_stdin_busy`.
#
# The process owns its state and numbers its changes; the hub relays them without reading or
# renumbering them. A subscriber starts pending: it receives management records (lifecycle,
# writer) but no state events until its snapshot is delivered. Since the process writes its
# snapshot and its events on one ordered stream, every event after the snapshot follows it,
# and none before it is needed.
#
# Effects:
#   {:write, record}                      a record for the process's stdin
#   {:broadcast, payload}                 a state event for every live subscriber
#   {:subscribe, ref}                     make the client a pending subscriber
#   {:snapshot, ref, request, payload}    deliver the snapshot, make the subscriber live,
#                                         and answer the request
#   {:ok, ref, request, payload}          a successful response
#   {:error, ref, request, code} | {:error, ref, request, code, payload}
#                                         an error response, with the engine's detail
#   {:transaction, state, effects, ref, request, payload}
#                                         run `effects`; on success adopt `state` and reply
#   {:ready} | {:fail, code}              the agent's lifecycle
#
# Writer. The Agent gives the write right to the first subscriber that becomes live by
# attaching while nobody holds it, to a subscriber that takes it, and to nobody when its
# holder goes away; a subscriber that subscribes again to resynchronize keeps its role.
# Each change increments the epoch, is reported to the engine through `writer/3` before any
# later input, and reaches every subscriber as a management record.
#
# The Agent passes requests on only while the agent is ready, and answers the others with
# `agent_starting` or `agent_unavailable` itself; the Manager forwards to it until it ends.
defmodule Shield.Engine do
  @type state :: term()
  @type effect :: tuple()
  @type ref :: %{pid: pid(), id: String.t()}

  @doc "The client harnesses that may attach to this engine's agents."
  @callback harnesses() :: [String.t()]
  @doc """
  Validates attach options for a new agent. The launch holds `descriptor` and `cwd` for the
  Agent, and whatever else `init/1` needs.
  """
  @callback launch(options :: map(), cwd :: String.t(), identity :: String.t()) ::
              {:ok, launch :: %{descriptor: map(), cwd: String.t()}} | {:error, String.t()}
  @callback init(launch :: map()) :: {state(), [effect()]}
  @doc "A client attaches to an agent: options it cannot join are the engine's to refuse."
  @callback attach(state(), ref(), request :: map(), options :: map()) :: {state(), [effect()]}
  @callback input(state(), ref(), request :: map(), now :: integer()) :: {state(), [effect()]}
  @callback output(state(), record :: map(), now :: integer()) :: {state(), [effect()]}
  @doc "The connection that may write changed; nil means nobody may."
  @callback writer(state(), connection :: String.t() | nil, epoch :: non_neg_integer()) ::
              {state(), [effect()]}
  @callback expire(state(), now :: integer()) :: {state(), [effect()]}
  @doc "A client went away; its unresolved requests must not be answered."
  @callback detach(state(), pid()) :: state()
  @doc "The Agent could not write the record with this id."
  @callback reject_write(state(), id :: String.t()) :: {state(), [effect()]}
  @doc "The process ended or the agent failed; unresolved requests are answered with `reason`."
  @callback failed(state(), reason :: String.t()) :: {state(), [effect()]}

  @engines %{"keel" => Shield.Keel}
  @default "keel"

  @doc "The engine a request that names none means."
  def default, do: @default

  @doc "The engine module registered under `name`."
  def fetch(name), do: Map.fetch(@engines, name)

  def known?(name), do: name == nil or Map.has_key?(@engines, name)
end
