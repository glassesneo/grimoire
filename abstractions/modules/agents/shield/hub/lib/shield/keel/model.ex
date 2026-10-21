# keel's model: every piece of state keel's screens show, as a pure state machine. The driver
# reports Pi's meaning as entries and its own run, queue, and session; extensions declare
# actions, presentations, and assists through it; screens run actions. The model numbers its
# changes, decides which operation may run, and tells the driver what to carry out.
#
# Every entry point returns the new model and its outputs, in order:
#   {:instruct, record}        an Instruction for the driver
#   {:ready} | {:fail, code}   the agent's lifecycle
#   {:broadcast, event}        the StateEvent of this step's changes, if any
#   {:reply, client, result}   the InvokeResult for a screen's request; `client` is the
#                              caller's opaque token
# The changes of one step become one event, which precedes the step's replies, so a reply's
# `appliedSeq` names an event its screen already has.
#
# Actions. An action runs in the model (drafts, sending, answering, accepting a candidate), in
# the driver (an extension's code), or in the screen's own code, which the model only
# declares (`ActionInfo.local`). An action of class `write` runs only for the connection the
# hub names as writer, and only when the screen's request names the writer epoch it saw; the
# check happens in input order, so a write sent before the writer changed is refused. The
# driver is told only what to run, with the model's verdict on the writer.
#
# Drafts carry a revision that grows with every change. A screen's edit names the revision it
# started from and is refused when the draft moved on.
#
# Sending the prompt. `editor.submit` claims the draft's revision for one attempt and gives the
# driver its text; a revision is claimed once. When Pi accepts it, the draft is cleared if it
# is still that revision; when Pi refuses it, the claim is released and the text stays. When
# whether Pi received it is unknown (the driver says so, or it does not answer within the
# deadline), the claim and the text stay and the model opens a choice request whose one
# option releases the claim. Nothing is resent on its own. A result that arrives before the
# release is applied and closes the request; one that arrives after it changes no draft and is
# only reported, with a warning when the prompt was sent again since. The attempt outlives
# the screen's request: a screen that went away or stopped waiting does not end it.
#
# Requests are the driver's (an extension asked, and the driver waits for the answer) or the
# model's own (the release above). Stopping the run cancels only the driver's.
defmodule Shield.Keel.Model do
  alias Shield.Keel.{Keys, Projection}

  @deadline 60_000
  @notice_prefix "keel-notice-"
  @prompt "prompt"

  # keel's own actions: those the model runs, and the screen's, which every screen has
  # whatever extensions are loaded. Global actions take no default keys; an operation useful
  # from several regions has an action in each.
  @own_actions [
                 %{"id" => "draft.set", "title" => "Edit a draft"},
                 %{
                   "id" => "editor.submit",
                   "title" => "Send the prompt",
                   "keys" => ["return", "kpenter"]
                 },
                 %{"id" => "request.answer", "title" => "Answer a request"},
                 # The candidate's own action is checked when it runs.
                 %{
                   "id" => "assist.accept",
                   "title" => "Accept an assist candidate",
                   "class" => "control"
                 }
               ]
               |> Enum.map(&Map.put(&1, :runs, :model))

  regions = fn name, ids, fields ->
    Enum.map(ids, &Map.merge(fields, %{"id" => "#{&1}.#{name}", runs: :screen}))
  end

  # The screen arms stop on the first press and invokes global.stop on the second.
  @screen_actions regions.("stop", ~w(editor timeline stage), %{
                    "class" => "control",
                    "title" => "Stop the run (press twice)",
                    "keys" => ["ctrl+c"]
                  }) ++
                    [
                      %{
                        "id" => "screen.take_write",
                        "class" => "control",
                        "title" => "Take the write right",
                        runs: :screen
                      }
                    ] ++
                    regions.("take_write", ~w(editor timeline), %{
                      "class" => "control",
                      "keys" => ["alt+w"]
                    }) ++
                    [
                      %{
                        "id" => "screen.detach",
                        "class" => "view",
                        "title" => "Close this screen",
                        runs: :screen
                      }
                    ] ++
                    regions.("detach", ~w(editor timeline stage), %{
                      "class" => "view",
                      "keys" => ["ctrl+q"]
                    }) ++
                    regions.("focus_next", ~w(editor timeline stage), %{
                      "class" => "view",
                      "keys" => ["tab"]
                    }) ++
                    regions.("focus_previous", ~w(editor timeline stage), %{
                      "class" => "view",
                      "keys" => ["shift+tab"]
                    }) ++
                    Enum.map(
                      [
                        {"editor.stage_next", ["alt+j"]},
                        {"editor.stage_previous", ["alt+k"]},
                        {"editor.stage_leave", ["escape"]},
                        {"editor.candidate_next", ["ctrl+n"]},
                        {"editor.candidate_previous", ["ctrl+p"]},
                        {"stage.next", ["l", "right"]},
                        {"stage.previous", ["h", "left"]},
                        {"stage.leave", ["escape"]},
                        {"stage.cursor_down", ["j", "down"]},
                        {"stage.cursor_up", ["k", "up"]}
                      ],
                      fn {id, keys} ->
                        %{"id" => id, "class" => "view", "keys" => keys, runs: :screen}
                      end
                    ) ++
                    [
                      # Answers the request or accepts the candidate the stage shows.
                      %{
                        "id" => "stage.confirm",
                        "class" => "control",
                        "keys" => ["return", "kpenter"],
                        runs: :screen
                      }
                    ]

  defstruct instance: nil,
            ready: false,
            seq: 0,
            writer: {nil, 0},
            session: %{"id" => "", "cwd" => "", "model" => nil, "thinking" => nil},
            run: %{"phase" => "idle", "compacting" => false, "retrying" => false},
            queue: %{"steering" => [], "followUp" => []},
            drafts: %{@prompt => %{"text" => "", "revision" => 0}},
            # Every draft's revisions come from this one counter, so a draft made again never
            # repeats a revision a screen saw before.
            revision: 0,
            # The latest prompt revision claimed for sending.
            claimed: -1,
            requests: [],
            next_request: 0,
            assists: [],
            actions: [],
            kinds: [],
            next_registration: 0,
            key_config: nil,
            keys: %{},
            reported: MapSet.new(),
            # Entry id to {entry, stamp}; a stamp, from one counter, marks each change.
            entries: %{},
            stamp: 0,
            order: [],
            notices: %{},
            next_notice: 0,
            projection: %Projection{},
            attempts: %{},
            pending: %{},
            next: 0,
            dirty: MapSet.new(),
            items_dirty: false,
            reordered: false,
            out: []

  def new(instance) do
    actions = Enum.map(@own_actions ++ @screen_actions, &Map.put(&1, :registration, nil))
    %__MODULE__{instance: instance, actions: actions}
  end

  # ---------------------------------------------------------------------------
  # Entry points
  # ---------------------------------------------------------------------------

  @doc "A record from the driver, already valid against the contract."
  def driver_record(m, record, now), do: m |> record(record, now) |> finish()

  @doc "A screen's invoke request, already valid against the contract."
  def invoke(m, client, connection, request, now) do
    writer = writer?(m, connection, request["writerEpoch"])

    m
    |> run_action(client, connection, writer, request["action"], request["args"], now)
    |> finish()
  end

  def writer(m, connection, epoch), do: %{m | writer: {connection, epoch}}

  @doc "Answers what waited past its deadline."
  def expire(m, now) do
    m =
      Enum.reduce(m.pending, m, fn
        {id, {:run_action, client, deadline}}, m when deadline <= now ->
          m
          |> forget(id)
          |> reply(client, unknown("acceptance_unknown", "the driver did not answer in time"))

        _, m ->
          m
      end)

    m =
      Enum.reduce(m.attempts, m, fn
        {id, %{state: :sending, deadline: deadline}}, m when deadline <= now ->
          became_unknown(
            m,
            id,
            :timed_out,
            "acceptance_unknown",
            "Pi did not report whether it took it in time"
          )

        _, m ->
          m
      end)

    finish(m)
  end

  @doc "Forgets the clients `gone?` names; what they waited for still happens."
  def drop_clients(m, gone?) do
    pending =
      Map.new(m.pending, fn
        {id, {:run_action, client, deadline}} ->
          {id, {:run_action, if(gone?.(client), do: nil, else: client), deadline}}

        other ->
          other
      end)

    attempts =
      Map.new(m.attempts, fn {id, a} ->
        {id, if(a.client && gone?.(a.client), do: %{a | client: nil}, else: a)}
      end)

    %{m | pending: pending, attempts: attempts}
  end

  @doc "The hub could not write the instruction `id`; the agent fails after this."
  def write_rejected(m, id) do
    m =
      case {m.pending[id], m.attempts[id]} do
        {{:run_action, client, _}, _} ->
          reply(forget(m, id), client, rejected("engine_write_rejected"))

        {_, %{client: client}} ->
          m |> forget(id) |> drop_attempt(id) |> reply(client, rejected("engine_write_rejected"))

        _ ->
          m
      end

    {replies, _} = m.out |> Enum.reverse() |> Enum.split_with(&match?({:reply, _, _}, &1))
    {%{m | out: []}, replies}
  end

  @doc """
  The driver ended or the agent failed: whoever waits is answered, and nothing changes the
  state screens show, which stays as it last was.
  """
  def failed(m, reason) do
    replies =
      for({_, {:run_action, client, _}} <- m.pending, client, do: client) ++
        for {_, %{state: :sending, client: client}} <- m.attempts, client, do: client

    message = "the driver ended (#{reason}) before reporting whether it took effect"
    out = Enum.map(replies, &{:reply, &1, unknown("acceptance_unknown", message)})
    {%{m | pending: %{}, attempts: %{}}, out}
  end

  @doc "The state as of the last change; every change of an entry point is published."
  def snapshot(m) do
    %{
      "instance" => m.instance,
      "seq" => m.seq,
      "state" => %{
        "session" => m.session,
        "run" => m.run,
        "items" => Projection.items(timeline(m), m.projection),
        "queue" => m.queue,
        "requests" => section(m, :requests),
        "assists" => section(m, :assists),
        "drafts" => m.drafts,
        "actions" => section(m, :actions),
        "keys" => m.keys,
        "kinds" => section(m, :kinds)
      }
    }
  end

  # ---------------------------------------------------------------------------
  # Driver records
  # ---------------------------------------------------------------------------

  defp record(%{ready: true} = m, %{"type" => "ready"}, _),
    do: emit(m, {:fail, "invalid_runtime_record"})

  defp record(m, %{"type" => "ready"} = r, _) do
    %{m | ready: true, session: r["session"], key_config: r["keys"]}
    |> mark(:session)
    |> apply_keys()
    |> emit({:ready})
  end

  # The model's notices have ids of their own; a tool entry's parent is a tool entry the driver
  # sent, and following parents always ends.
  defp record(m, %{"type" => "entries"} = r, _) do
    # A call moved to another tool changes what both show, as a new order does.
    {entries, new, stamp, moved} =
      Enum.reduce(r["entries"], {m.entries, [], m.stamp, false}, fn entry,
                                                                    {entries, new, stamp, moved} ->
        {new, moved} =
          case entries[entry["id"]] do
            nil -> {[entry["id"] | new], moved}
            {old, _} -> {new, moved or old["parentId"] != entry["parentId"]}
          end

        {Map.put(entries, entry["id"], {entry, stamp + 1}), new, stamp + 1, moved}
      end)

    order =
      case {r["order"], new} do
        # A change of known entries, as while a response streams, leaves the order alone.
        {nil, []} -> m.order
        {nil, new} -> m.order ++ Enum.reverse(new)
        {order, new} -> if same_entries?(order, m.order, new), do: order
      end

    if order != nil and
         not Enum.any?(r["entries"], &String.starts_with?(&1["id"], @notice_prefix)) and
         Enum.all?(r["entries"], &rooted?(entries, &1)),
       do: %{
         m
         | entries: entries,
           stamp: stamp,
           order: order,
           items_dirty: true,
           reordered: m.reordered or moved or order != m.order
       },
       else: emit(m, {:fail, "invalid_runtime_record"})
  end

  defp record(m, %{"type" => "status"} = r, _) do
    Enum.reduce([{"session", :session}, {"run", :run}, {"queue", :queue}], m, fn {key, field},
                                                                                 m ->
      case r[key] do
        nil -> m
        value when value == :erlang.map_get(field, m) -> m
        value -> m |> Map.put(field, value) |> mark(field)
      end
    end)
  end

  defp record(m, %{"type" => "operation", "id" => id, "operation" => op}, _) do
    case operation(m, op) do
      {:ok, m, value} ->
        instruct(m, %{
          "type" => "operation_result",
          "id" => id,
          "outcome" => "ok",
          "value" => value
        })

      {:error, m, code, message} ->
        m
        |> notice("warning", message)
        |> instruct(%{
          "type" => "operation_result",
          "id" => id,
          "outcome" => "rejected",
          "code" => code,
          "message" => message
        })
    end
  end

  defp record(m, %{"type" => "result", "id" => id, "result" => result}, _) do
    case m.pending[id] do
      nil ->
        if issued?(m, id), do: m, else: emit(m, {:fail, "uncorrelated_runtime_record"})

      {:run_action, client, _} ->
        m = forget(m, id)

        case result do
          %{"outcome" => outcome} when outcome in ["done", "accepted"] ->
            reply(m, client, Map.put(result, "appliedSeq", :seq))

          %{"outcome" => outcome} when outcome in ["rejected", "unknown"] ->
            reply(m, client, result)

          _ ->
            emit(m, {:fail, "invalid_runtime_record"})
        end

      :submit ->
        m |> forget(id) |> submitted(id, result)

      {:assist, assist, registration, revision} ->
        m |> forget(id) |> candidates(assist, registration, revision, result)
    end
  end

  defp record(m, %{"type" => "fail", "code" => code}, _), do: emit(m, {:fail, code})

  # Instruction ids are `m<n>`; one issued earlier and no longer pending timed out.
  defp issued?(m, "m" <> n) do
    case Integer.parse(n) do
      {n, ""} -> n < m.next
      _ -> false
    end
  end

  defp issued?(_, _), do: false

  # A new order lists every entry, the new ones included, once.
  defp same_entries?(order, known, new) do
    listed = MapSet.new(order)

    length(order) == length(known) + length(new) and MapSet.size(listed) == length(order) and
      Enum.all?(new, &MapSet.member?(listed, &1)) and
      Enum.all?(known, &MapSet.member?(listed, &1))
  end

  defp rooted?(entries, entry, seen \\ MapSet.new())

  defp rooted?(entries, %{"kind" => "tool", "parentId" => parent} = entry, seen) do
    seen = MapSet.put(seen, entry["id"])

    case entries[parent] do
      {%{"kind" => "tool"} = up, _} ->
        not MapSet.member?(seen, parent) and rooted?(entries, up, seen)

      _ ->
        false
    end
  end

  defp rooted?(_, _, _), do: true

  defp forget(m, id), do: %{m | pending: Map.delete(m.pending, id)}

  # ---------------------------------------------------------------------------
  # Operations of the driver
  # ---------------------------------------------------------------------------

  defp operation(m, %{"op" => "declare_actions", "actions" => actions}) do
    ids = Enum.map(actions, & &1["id"])
    taken = MapSet.new(m.actions, & &1["id"])

    problem =
      Enum.find_value(Enum.with_index(ids), fn {id, index} ->
        cond do
          not Keys.valid_action_id?(id) -> "invalid action id: #{id}"
          MapSet.member?(taken, id) or id in Enum.take(ids, index) -> "duplicate action: #{id}"
          true -> nil
        end
      end)

    if problem do
      {:error, m, "invalid_declaration", "declaring actions failed: #{problem}"}
    else
      {m, registration} = registration(m)

      declared =
        Enum.map(actions, fn a ->
          a
          |> Map.take(["id", "class", "title", "keys"])
          |> Map.merge(%{runs: String.to_existing_atom(a["runs"]), registration: registration})
        end)

      m = %{m | actions: m.actions ++ declared} |> mark(:actions) |> apply_keys()
      {:ok, m, %{"registration" => registration}}
    end
  end

  defp operation(m, %{"op" => "present", "kind" => kind, "renderer" => renderer}) do
    if List.keymember?(m.kinds, kind, 0) do
      {:error, m, "invalid_declaration", "items of #{kind} are already presented"}
    else
      {m, registration} = registration(m)
      m = %{m | kinds: m.kinds ++ [{kind, renderer, registration}]} |> mark(:kinds)
      {:ok, m, %{"registration" => registration}}
    end
  end

  defp operation(m, %{"op" => "declare_assist", "id" => id, "title" => title}) do
    cond do
      not Regex.match?(~r/\A[a-z0-9_-]+\z/, id) ->
        {:error, m, "invalid_declaration", "invalid assist id: #{id}"}

      Enum.any?(m.assists, &(&1.info["id"] == id)) ->
        {:error, m, "invalid_declaration", "duplicate assist: #{id}"}

      true ->
        {m, registration} = registration(m)
        destination = "assist:" <> id

        info = %{
          "id" => id,
          "title" => title,
          "destination" => destination,
          "revision" => -1,
          "candidates" => []
        }

        m =
          %{m | assists: m.assists ++ [%{info: info, registration: registration, pending: nil}]}
          |> new_draft(destination)
          |> mark(:assists)
          |> refresh_assist(id)

        {:ok, m, %{"registration" => registration}}
    end
  end

  defp operation(m, %{"op" => "withdraw", "registration" => registration}) do
    {gone, actions} = Enum.split_with(m.actions, &(&1.registration == registration))
    {gone_kinds, kinds} = Enum.split_with(m.kinds, &(elem(&1, 2) == registration))
    {gone_assists, assists} = Enum.split_with(m.assists, &(&1.registration == registration))

    m =
      if gone == [], do: m, else: %{m | actions: actions} |> mark(:actions) |> apply_keys()

    m = if gone_kinds == [], do: m, else: %{m | kinds: kinds} |> mark(:kinds)

    m =
      if gone_assists == [] do
        m
      else
        drafts = Map.drop(m.drafts, Enum.map(gone_assists, & &1.info["destination"]))
        %{m | assists: assists, drafts: drafts} |> mark(:assists) |> mark(:drafts)
      end

    {:ok, m, %{}}
  end

  defp operation(m, %{"op" => "list_assists"}),
    do: {:ok, m, %{"assists" => Enum.map(m.assists, & &1.info["id"])}}

  defp operation(m, %{"op" => op, "destination" => destination, "text" => text})
       when op in ["set_draft", "append_draft"] do
    if open?(m, destination) do
      text =
        case {op, m.drafts[destination]["text"]} do
          {"append_draft", existing} when existing != "" -> existing <> "\n\n" <> text
          _ -> text
        end

      {m, revision} = set_draft(m, destination, text)
      {:ok, m, %{"revision" => revision}}
    else
      {:error, m, "closed_destination", "no open draft #{destination}"}
    end
  end

  defp operation(m, %{"op" => "open_request"} = op) do
    {m, id} =
      open_request(
        m,
        :driver,
        Map.take(op, ["kind", "title", "message", "options"]),
        op["supplement"]
      )

    {:ok, m, %{"request" => id}}
  end

  defp operation(m, %{"op" => "cancel_request", "request" => id}) do
    case find_request(m, id) do
      %{origin: :driver} -> {:ok, close_request(m, id, %{"status" => "cancelled"}), %{}}
      _ -> {:ok, m, %{}}
    end
  end

  defp operation(m, %{"op" => "cancel_requests"}) do
    m =
      for(%{origin: :driver, info: info} <- m.requests, do: info["id"])
      |> Enum.reduce(m, &close_request(&2, &1, %{"status" => "cancelled"}))

    {:ok, m, %{}}
  end

  defp registration(m),
    do: {%{m | next_registration: m.next_registration + 1}, "g#{m.next_registration}"}

  # ---------------------------------------------------------------------------
  # Actions
  # ---------------------------------------------------------------------------

  defp writer?(%{writer: {connection, epoch}}, from, seen),
    do: connection != nil and connection == from and seen == epoch

  defp run_action(m, client, connection, writer, id, args, now) do
    action = Enum.find(m.actions, &(&1["id"] == id))

    cond do
      action == nil ->
        reply(m, client, rejected("unknown_action", "no action #{id}"))

      (action["class"] || "write") == "write" and not writer ->
        reply(m, client, rejected("not_writer", "#{id} needs the write right"))

      action.runs == :screen ->
        reply(m, client, rejected("screen_action", "#{id} runs on the screen"))

      action.runs == :driver ->
        {m, instruction} = issue(m)

        m
        |> Map.update!(
          :pending,
          &Map.put(&1, instruction, {:run_action, client, now + @deadline})
        )
        |> instruct(
          %{
            "type" => "run_action",
            "id" => instruction,
            "action" => id,
            "connection" => connection,
            "writer" => writer
          }
          |> put_present("args", args)
        )

      true ->
        own(m, client, connection, writer, id, args, now)
    end
  end

  defp own(m, client, _, _, "draft.set", args, _) do
    with {:ok, destination} <- field(args, "destination", &is_binary/1),
         {:ok, text} <- field(args, "text", &is_binary/1),
         {:ok, base} <- field(args, "base", &is_integer/1) do
      cond do
        not open?(m, destination) ->
          reply(m, client, rejected("closed_destination"))

        base != m.drafts[destination]["revision"] ->
          reply(m, client, rejected("stale_revision"))

        true ->
          {m, revision} = set_draft(m, destination, text)
          reply(m, client, done(%{"revision" => revision}))
      end
    else
      {:error, result} -> reply(m, client, result)
    end
  end

  defp own(m, client, _, _, "editor.submit", args, now) do
    with {:ok, destination} <- field(args, "destination", &is_binary/1),
         {:ok, revision} <- field(args, "revision", &is_integer/1) do
      draft = m.drafts[@prompt]
      text = String.trim(draft["text"])

      cond do
        destination != @prompt ->
          reply(m, client, rejected("invalid_arguments", "only the prompt is sent"))

        m.run["phase"] == "stopping" ->
          reply(m, client, rejected("stopping"))

        draft["revision"] != revision or revision <= m.claimed ->
          reply(m, client, rejected("stale_revision"))

        text == "" ->
          reply(m, client, rejected("empty"))

        true ->
          {m, id} = issue(m)

          attempt = %{
            text: text,
            revision: revision,
            previous: m.claimed,
            state: :sending,
            client: client,
            request: nil,
            resent: false,
            deadline: now + @deadline
          }

          # A prompt sent while another one's acceptance is unknown may duplicate it.
          attempts =
            Map.new(m.attempts, fn {key, a} ->
              {key, if(a.state == :sending, do: a, else: %{a | resent: true})}
            end)

          %{m | attempts: Map.put(attempts, id, attempt), claimed: revision}
          |> Map.update!(:pending, &Map.put(&1, id, :submit))
          |> instruct(%{"type" => "submit", "id" => id, "text" => text})
      end
    else
      {:error, result} -> reply(m, client, result)
    end
  end

  defp own(m, client, _, _, "request.answer", args, _) do
    with {:ok, id} <- field(args, "request", &is_binary/1),
         {:ok, value} <- field(args, "value", &is_binary/1) do
      request = find_request(m, id)

      cond do
        request == nil ->
          reply(m, client, rejected("request_closed"))

        value not in request.info["options"] ->
          reply(m, client, rejected("invalid_answer"))

        Map.has_key?(request.info, "destination") ->
          case field(args, "revision", &is_integer/1) do
            {:ok, revision} ->
              draft = m.drafts[request.info["destination"]]

              if draft["revision"] != revision,
                do: reply(m, client, rejected("stale_revision")),
                else: m |> answer(request, value, draft["text"]) |> reply(client, done(nil))

            {:error, result} ->
              reply(m, client, result)
          end

        true ->
          m |> answer(request, value, nil) |> reply(client, done(nil))
      end
    else
      {:error, result} -> reply(m, client, result)
    end
  end

  defp own(m, client, connection, writer, "assist.accept", args, now) do
    with {:ok, id} <- field(args, "assist", &is_binary/1),
         {:ok, revision} <- field(args, "revision", &is_integer/1),
         {:ok, candidate_id} <- field(args, "candidate", &is_binary/1) do
      assist = Enum.find(m.assists, &(&1.info["id"] == id))

      cond do
        assist == nil ->
          reply(m, client, rejected("unknown_assist"))

        # The candidates must be the ones computed from the draft as it is now.
        assist.info["revision"] != revision or
            m.drafts[assist.info["destination"]]["revision"] != revision ->
          reply(m, client, rejected("stale_revision", "the candidates are for an older draft"))

        true ->
          case Enum.find(assist.info["candidates"], &(&1["id"] == candidate_id)) do
            nil ->
              reply(m, client, rejected("unknown_candidate"))

            # Accepting a candidate never accepts another one, so it always ends.
            %{"action" => %{"id" => "assist.accept"}} ->
              reply(
                m,
                client,
                rejected("invalid_candidate", "a candidate cannot accept a candidate")
              )

            candidate ->
              action = candidate["action"]
              run_action(m, client, connection, writer, action["id"], action["args"], now)
          end
      end
    else
      {:error, result} -> reply(m, client, result)
    end
  end

  defp field(args, name, check) do
    value = if is_map(args), do: args[name]

    if check.(value),
      do: {:ok, value},
      else: {:error, rejected("invalid_arguments", "#{name} is missing or invalid")}
  end

  # ---------------------------------------------------------------------------
  # Sending the prompt
  # ---------------------------------------------------------------------------

  # An attempt is `:sending` until the driver answers; `:timed_out` when it did not answer in
  # time, so its answer may still come; `:unknown` when the driver said it does not know, so
  # nothing more comes; `:released` when the claim of a timed-out attempt was released.
  defp submitted(m, id, result) do
    attempt = m.attempts[id]

    case {attempt.state, result} do
      {:released, _} ->
        m |> late(attempt, result) |> drop_attempt(id)

      {_, %{"outcome" => "submitted", "disposition" => disposition}} ->
        m =
          if m.drafts[@prompt]["revision"] == attempt.revision,
            do: m |> set_draft(@prompt, "") |> elem(0),
            else: m

        m
        |> close_recovery(attempt)
        |> reply(attempt.client, accepted(%{"disposition" => disposition}))
        |> drop_attempt(id)

      {_, %{"outcome" => "rejected"}} ->
        m
        |> release(attempt)
        |> close_recovery(attempt)
        |> reply(attempt.client, result)
        |> drop_attempt(id)

      {:sending, %{"outcome" => "unknown", "code" => code} = r} ->
        became_unknown(m, id, :unknown, code, r["message"])

      {:timed_out, %{"outcome" => "unknown"}} ->
        m |> set_attempt(id, :unknown)

      _ ->
        emit(m, {:fail, "invalid_runtime_record"})
    end
  end

  defp set_attempt(m, id, state), do: update_in(m.attempts[id], &%{&1 | state: state})

  defp became_unknown(m, id, state, code, message) do
    attempt = m.attempts[id]
    reason = message || code

    {m, request} =
      open_request(
        m,
        {:recovery, id},
        %{
          "kind" => "choice",
          "title" => "Was the prompt sent?",
          "message" =>
            "Pi did not confirm that it took this prompt (#{reason}). It stays claimed, so it " <>
              "cannot be sent again until the claim is released; sending it again may send it " <>
              "twice.\n\n" <> attempt.text,
          "options" => ["Release the claim"]
        },
        false
      )

    attempts =
      Map.put(m.attempts, id, %{attempt | state: state, request: request, client: nil})

    %{m | attempts: attempts}
    |> reply(attempt.client, unknown(code, message))
  end

  # The same revision may be claimed again, unless a later one was claimed meanwhile.
  defp release(m, attempt) do
    if m.claimed == attempt.revision, do: %{m | claimed: attempt.previous}, else: m
  end

  defp close_recovery(m, %{request: nil}), do: m
  defp close_recovery(m, %{request: request}), do: drop_request(m, request)

  defp drop_attempt(m, id), do: %{m | attempts: Map.delete(m.attempts, id)}

  defp late(m, attempt, result) do
    again =
      if attempt.resent, do: "; a prompt was sent since, so it may have been sent twice", else: ""

    text =
      case result do
        %{"outcome" => "submitted"} ->
          "Pi took a prompt after its claim was released#{again}"

        %{"outcome" => "rejected", "code" => code} ->
          "Pi refused a prompt after its claim was released (#{code})"

        _ ->
          "Whether Pi took a prompt whose claim was released is still unknown#{again}"
      end

    notice(m, "warning", text)
  end

  # ---------------------------------------------------------------------------
  # Requests
  # ---------------------------------------------------------------------------

  defp open_request(m, origin, info, supplement) do
    id = "r#{m.next_request}"
    info = info |> Map.put("id", id) |> Map.reject(fn {_, v} -> v == nil end)

    {info, m} =
      if supplement do
        destination = "request:" <> id
        {Map.put(info, "destination", destination), new_draft(m, destination)}
      else
        {info, m}
      end

    m = %{
      m
      | requests: m.requests ++ [%{info: info, origin: origin}],
        next_request: m.next_request + 1
    }

    {mark(m, :requests), id}
  end

  defp find_request(m, id), do: Enum.find(m.requests, &(&1.info["id"] == id))

  defp answer(m, %{origin: :driver, info: info}, value, supplement) do
    value = if info["kind"] == "confirm", do: value == hd(info["options"]), else: value

    close_request(
      m,
      info["id"],
      %{"status" => "answered", "value" => value} |> put_present("supplement", supplement)
    )
  end

  # Releasing the claim sends nothing.
  defp answer(m, %{origin: {:recovery, attempt_id}, info: info}, _, _) do
    m = drop_request(m, info["id"])

    case m.attempts[attempt_id] do
      # A timed-out attempt's answer may still come and is then reported.
      %{state: :timed_out} = attempt ->
        attempts = Map.put(m.attempts, attempt_id, %{attempt | state: :released, request: nil})
        release(%{m | attempts: attempts}, attempt)

      %{state: :unknown} = attempt ->
        m |> drop_attempt(attempt_id) |> release(attempt)

      _ ->
        m
    end
  end

  defp close_request(m, id, answer) do
    m
    |> drop_request(id)
    |> instruct(%{"type" => "request_closed", "request" => id, "answer" => answer})
  end

  defp drop_request(m, id) do
    case find_request(m, id) do
      nil ->
        m

      request ->
        m = %{m | requests: List.delete(m.requests, request)} |> mark(:requests)

        case request.info["destination"] do
          nil -> m
          destination -> %{m | drafts: Map.delete(m.drafts, destination)} |> mark(:drafts)
        end
    end
  end

  # ---------------------------------------------------------------------------
  # Drafts and assists
  # ---------------------------------------------------------------------------

  defp open?(_, @prompt), do: true

  defp open?(m, "request:" <> id),
    do: match?(%{info: %{"destination" => _}}, find_request(m, id))

  defp open?(m, "assist:" <> id), do: Enum.any?(m.assists, &(&1.info["id"] == id))
  defp open?(_, _), do: false

  defp new_draft(m, destination) do
    revision = m.revision + 1
    drafts = Map.put(m.drafts, destination, %{"text" => "", "revision" => revision})
    mark(%{m | drafts: drafts, revision: revision}, :drafts)
  end

  # Only an open draft is set.
  defp set_draft(m, destination, text) do
    previous = m.drafts[destination]

    if previous["text"] == text do
      {m, previous["revision"]}
    else
      revision = m.revision + 1
      drafts = Map.put(m.drafts, destination, %{"text" => text, "revision" => revision})
      m = mark(%{m | drafts: drafts, revision: revision}, :drafts)

      m =
        case destination do
          "assist:" <> id -> refresh_assist(m, id)
          _ -> m
        end

      {m, revision}
    end
  end

  defp refresh_assist(m, id) do
    index = Enum.find_index(m.assists, &(&1.info["id"] == id))
    assist = Enum.at(m.assists, index)
    revision = m.drafts[assist.info["destination"]]["revision"]
    {m, instruction} = issue(m)

    %{m | assists: List.replace_at(m.assists, index, %{assist | pending: revision})}
    |> Map.update!(
      :pending,
      &Map.put(&1, instruction, {:assist, id, assist.registration, revision})
    )
    |> instruct(%{
      "type" => "query_assist",
      "id" => instruction,
      "assist" => id,
      "text" => m.drafts[assist.info["destination"]]["text"]
    })
  end

  defp candidates(m, id, registration, revision, result) do
    index = Enum.find_index(m.assists, &(&1.info["id"] == id and &1.registration == registration))
    assist = index && Enum.at(m.assists, index)

    cond do
      # A result for a withdrawn assist, or an older draft, is discarded.
      assist == nil or assist.pending != revision ->
        m

      true ->
        {list, m} =
          case result do
            %{"outcome" => "candidates", "candidates" => list} ->
              {list, m}

            %{"outcome" => "rejected"} = r ->
              {[], notice(m, "warning", "assist #{id}: #{r["message"] || r["code"]}")}

            _ ->
              {[], emit(m, {:fail, "invalid_runtime_record"})}
          end

        info = %{assist.info | "revision" => revision, "candidates" => list}
        assists = List.replace_at(m.assists, index, %{assist | info: info, pending: nil})
        mark(%{m | assists: assists}, :assists)
    end
  end

  # ---------------------------------------------------------------------------
  # Keys, notices, and publishing
  # ---------------------------------------------------------------------------

  # Keys apply once the driver is ready, when every extension has declared its actions.
  defp apply_keys(%{ready: false} = m), do: m

  defp apply_keys(m) do
    {keys, diagnostics} = Keys.apply(m.actions, m.key_config)

    m =
      Enum.reduce(diagnostics, m, fn {level, text}, m ->
        if MapSet.member?(m.reported, text),
          do: m,
          else: %{m | reported: MapSet.put(m.reported, text)} |> notice(level, text)
      end)

    if keys == m.keys, do: m, else: mark(%{m | keys: keys}, :keys)
  end

  # The model's own notices follow the driver entry that was last when they were made.
  defp notice(m, level, text) do
    id = @notice_prefix <> Integer.to_string(m.next_notice)
    entry = %{"kind" => "notice", "id" => id, "version" => 0, "level" => level, "text" => text}
    anchor = List.last(m.order)

    %{
      m
      | entries: Map.put(m.entries, id, {entry, m.stamp + 1}),
        stamp: m.stamp + 1,
        notices: Map.update(m.notices, anchor, [id], &(&1 ++ [id])),
        next_notice: m.next_notice + 1,
        items_dirty: true,
        reordered: true
    }
  end

  defp timeline(m) do
    ids =
      Map.get(m.notices, nil, []) ++ Enum.flat_map(m.order, &[&1 | Map.get(m.notices, &1, [])])

    Enum.map(ids, &m.entries[&1])
  end

  defp section(m, :requests), do: Enum.map(m.requests, & &1.info)
  defp section(m, :assists), do: Enum.map(m.assists, & &1.info)
  defp section(m, :kinds), do: Map.new(m.kinds, fn {kind, renderer, _} -> {kind, renderer} end)

  defp section(m, :actions) do
    Enum.map(m.actions, fn a ->
      %{"id" => a["id"], "class" => a["class"] || "write", "local" => a.runs == :screen}
      |> put_present("title", a["title"])
    end)
  end

  defp section(m, field), do: Map.fetch!(m, field)

  defp mark(m, section), do: %{m | dirty: MapSet.put(m.dirty, section)}

  defp issue(m), do: {%{m | next: m.next + 1}, "m#{m.next}"}

  defp instruct(m, record), do: emit(m, {:instruct, record})
  defp emit(m, output), do: %{m | out: [output | m.out]}

  defp reply(m, nil, _), do: m
  defp reply(m, client, result), do: emit(m, {:reply, client, result})

  # Publishes this step's changes as one event, ahead of its replies.
  defp finish(m) do
    {m, changes} =
      if m.items_dirty do
        {projection, changed, order} =
          Projection.publish(m.projection, timeline(m), m.reordered)

        changes =
          %{}
          |> then(&if(changed == [], do: &1, else: Map.put(&1, "items", changed)))
          |> put_present("order", order)

        {%{m | projection: projection, items_dirty: false, reordered: false}, changes}
      else
        {m, %{}}
      end

    changes = Enum.reduce(m.dirty, changes, &Map.put(&2, Atom.to_string(&1), section(m, &1)))
    m = %{m | dirty: MapSet.new()}

    {m, event} =
      if map_size(changes) == 0,
        do: {m, []},
        else:
          {%{m | seq: m.seq + 1},
           [{:broadcast, %{"instance" => m.instance, "seq" => m.seq + 1, "changes" => changes}}]}

    {replies, others} = m.out |> Enum.reverse() |> Enum.split_with(&match?({:reply, _, _}, &1))

    replies =
      Enum.map(replies, fn
        {:reply, client, %{"appliedSeq" => :seq} = result} ->
          {:reply, client, Map.put(result, "appliedSeq", m.seq)}

        other ->
          other
      end)

    {%{m | out: []}, others ++ event ++ replies}
  end

  defp put_present(map, _, nil), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)

  defp rejected(code, message \\ nil),
    do: %{"outcome" => "rejected", "code" => code} |> put_present("message", message)

  defp unknown(code, message),
    do: %{"outcome" => "unknown", "code" => code} |> put_present("message", message)

  defp done(nil), do: %{"outcome" => "done", "appliedSeq" => :seq}
  defp done(detail), do: %{"outcome" => "done", "appliedSeq" => :seq, "detail" => detail}
  defp accepted(detail), do: %{"outcome" => "accepted", "appliedSeq" => :seq, "detail" => detail}
end
