# The model's guarantees without Pi or a hub: a scripted driver sends contract records, screens
# invoke actions, and what the model gives back (instructions, events, replies, snapshots) is
# all a test observes. Every output is also checked against the keel contract.
defmodule Shield.Keel.ModelTest do
  use ExUnit.Case, async: true
  alias Shield.Keel.{Contract, Model}

  @session %{"id" => "s", "cwd" => "/w", "model" => "faux/faux", "thinking" => "medium"}

  # A model with its outputs collected, the outputs of the last step, a mirror that follows its
  # events as a screen does, and the writer the test told it about.
  defp fresh,
    do: %{model: Model.new("instance"), out: [], last: [], mirror: nil, now: 0, epoch: 0}

  defp start(declare \\ []) do
    t =
      Enum.reduce(declare, fresh(), fn {id, operation}, t ->
        driver(t, %{"type" => "operation", "id" => id, "operation" => operation})
      end)

    t
    |> driver(%{"type" => "ready", "session" => @session})
    |> then(fn t -> %{t | mirror: Model.snapshot(t.model)} end)
    |> writer("a", 1)
  end

  defp step(t, {model, out}) do
    for o <- out do
      case o do
        {:instruct, r} -> assert Contract.valid?("Instruction", r), inspect(r)
        {:broadcast, e} -> assert Contract.valid?("StateEvent", e), inspect(e)
        {:reply, _, r} -> assert Contract.valid?("InvokeResult", r), inspect(r)
        _ -> :ok
      end
    end

    assert Contract.valid?("Snapshot", Model.snapshot(model))
    mirror = Enum.reduce(for({:broadcast, e} <- out, do: e), t.mirror, &apply_event/2)
    %{t | model: model, out: t.out ++ out, last: out, mirror: mirror}
  end

  defp apply_event(_, nil), do: nil

  defp apply_event(event, mirror) do
    assert event["seq"] == mirror["seq"] + 1
    changes = event["changes"]
    upserts = Map.new(changes["items"] || [], &{&1["id"], &1})
    old = Map.new(mirror["state"]["items"], &{&1["id"], &1})

    items =
      case changes["order"] do
        nil -> Enum.map(mirror["state"]["items"], &Map.get(upserts, &1["id"], &1))
        order -> Enum.map(order, &(upserts[&1] || old[&1]))
      end

    state =
      changes
      |> Map.drop(["items", "order"])
      |> Enum.reduce(%{mirror["state"] | "items" => items}, fn {k, v}, s -> Map.put(s, k, v) end)

    %{mirror | "seq" => event["seq"], "state" => state}
  end

  defp driver(t, record) do
    assert Contract.valid?("DriverRecord", record), inspect(record)
    step(t, Model.driver_record(t.model, record, t.now))
  end

  defp writer(t, connection, epoch),
    do: %{t | model: Model.writer(t.model, connection, epoch), epoch: epoch}

  defp expire(t, now), do: step(%{t | now: now}, Model.expire(t.model, now))

  defp invoke(t, action, args \\ nil, connection \\ "a", epoch \\ :current) do
    epoch = if epoch == :current, do: t.epoch, else: epoch
    request = %{"op" => "invoke", "action" => action}
    request = if args, do: Map.put(request, "args", args), else: request
    request = if epoch, do: Map.put(request, "writerEpoch", epoch), else: request
    client = make_ref()
    t = step(t, Model.invoke(t.model, client, connection, request, t.now))
    {t, client}
  end

  # The reply to `client`, which must have arrived.
  defp result(t, client) do
    Enum.find_value(t.out, fn
      {:reply, ^client, r} -> r
      _ -> nil
    end) || flunk("no reply")
  end

  defp replied?(t, client), do: Enum.any?(t.out, &match?({:reply, ^client, _}, &1))

  defp call(t, action, args \\ nil, connection \\ "a", epoch \\ :current) do
    {t, client} = invoke(t, action, args, connection, epoch)
    {t, result(t, client)}
  end

  defp instructions(t, type), do: for({:instruct, %{"type" => ^type} = r} <- t.out, do: r)
  defp broadcasts(out), do: for({:broadcast, e} <- out, do: e)
  defp state(t), do: Model.snapshot(t.model)["state"]
  defp texts(t), do: Enum.map(state(t)["items"], & &1["text"])

  defp op(t, id, operation),
    do: driver(t, %{"type" => "operation", "id" => id, "operation" => operation})

  defp op_result(t, id) do
    Enum.find(instructions(t, "operation_result"), &(&1["id"] == id)) || flunk("no result #{id}")
  end

  # Opens a request as the driver does and returns its id.
  defp open(t, id, fields) do
    request =
      Map.merge(%{"op" => "open_request", "kind" => "choice", "title" => "Pick"}, fields)

    t = op(t, id, request)
    {t, op_result(t, id)["value"]["request"]}
  end

  defp set(t, destination, text) do
    base = state(t)["drafts"][destination]["revision"]
    {t, r} = call(t, "draft.set", %{"destination" => destination, "text" => text, "base" => base})
    assert r["outcome"] == "done", inspect(r)
    {t, r["detail"]["revision"]}
  end

  defp submit(t, revision),
    do: invoke(t, "editor.submit", %{"destination" => "prompt", "revision" => revision})

  defp answer_driver(t, instruction, result),
    do: driver(t, %{"type" => "result", "id" => instruction["id"], "result" => result})

  defp driver_actions(ids, runs \\ "driver", class \\ "control"),
    do: %{
      "op" => "declare_actions",
      "actions" => Enum.map(ids, &%{"id" => &1, "class" => class, "runs" => runs})
    }

  defp tool(id, fields \\ %{}) do
    Map.merge(
      %{
        "kind" => "tool",
        "id" => id,
        "version" => 0,
        "callId" => id,
        "name" => "read",
        "args" => %{"available" => true, "value" => %{}},
        "state" => "running"
      },
      fields
    )
  end

  # A prompt sent and left with unknown acceptance by the deadline; returns the submit sent.
  defp unknown_prompt(t, text) do
    {t, revision} = set(t, "prompt", text)
    {t, _} = submit(t, revision)
    sent = List.last(instructions(t, "submit"))
    {expire(t, t.now + 60_001), sent, revision}
  end

  defp recovery(t), do: Enum.find(state(t)["requests"], &(&1["options"] == ["Release the claim"]))

  defp release(t, connection \\ "a") do
    request = recovery(t)

    call(
      t,
      "request.answer",
      %{"request" => request["id"], "value" => "Release the claim"},
      connection
    )
  end

  test "each step's changes are one event after the snapshot, and the state the events build equals a late snapshot" do
    t = start()
    {t, _} = set(t, "prompt", "one")

    t =
      driver(t, %{
        "type" => "entries",
        "entries" => [
          %{"kind" => "user", "id" => "user-0", "version" => 0, "text" => "one", "images" => []}
        ]
      })

    running = %{"phase" => "running", "compacting" => false, "retrying" => false}
    t = driver(t, %{"type" => "status", "run" => running})
    assert [_] = broadcasts(t.last)
    # A report that changes nothing publishes nothing.
    t = driver(t, %{"type" => "status", "run" => running})
    assert broadcasts(t.last) == []
    assert t.mirror == Model.snapshot(t.model)
    assert texts(t) == ["> one"]
  end

  test "a step's event precedes its replies, which name it as applied" do
    t = start()
    {t, client} = invoke(t, "draft.set", %{"destination" => "prompt", "text" => "a", "base" => 0})
    [event] = broadcasts(t.last)
    event_at = Enum.find_index(t.last, &match?({:broadcast, _}, &1))
    reply_at = Enum.find_index(t.last, &match?({:reply, ^client, _}, &1))
    assert event_at < reply_at
    assert result(t, client)["appliedSeq"] == event["seq"]
  end

  test "only the writer writes, under the epoch it saw; control actions need no write" do
    t = start([{"d", driver_actions(["global.pause"])}])
    base = state(t)["drafts"]["prompt"]["revision"]
    edit = %{"destination" => "prompt", "text" => "x", "base" => base}
    assert {_, %{"code" => "not_writer"}} = call(t, "draft.set", edit, "b")
    assert {_, %{"code" => "not_writer"}} = call(t, "draft.set", edit, "a", 0)
    assert {_, %{"code" => "not_writer"}} = call(t, "draft.set", edit, "a", nil)

    assert {t, %{"outcome" => "done", "detail" => %{"revision" => _}}} =
             call(t, "draft.set", edit)

    t = writer(t, "b", 2)
    edit = %{edit | "base" => state(t)["drafts"]["prompt"]["revision"]}
    assert {_, %{"code" => "not_writer"}} = call(t, "draft.set", edit, "a")
    # A control action reaches the driver with the model's verdict on the writer.
    {t, _} = invoke(t, "global.pause", nil, "a")

    assert [%{"action" => "global.pause", "connection" => "a", "writer" => false}] =
             instructions(t, "run_action")

    assert {_, %{"code" => "unknown_action"}} = call(t, "timeline.cursor_down")
  end

  test "a draft edit must start from its revision and name an open destination" do
    t = start()

    {t, %{"outcome" => "done"}} =
      call(t, "draft.set", %{"destination" => "prompt", "text" => "a", "base" => 0})

    assert {_, %{"code" => "stale_revision"}} =
             call(t, "draft.set", %{"destination" => "prompt", "text" => "b", "base" => 0})

    assert {_, %{"code" => "closed_destination"}} =
             call(t, "draft.set", %{"destination" => "request:r9", "text" => "b", "base" => 0})

    assert {_, %{"code" => "invalid_arguments"}} =
             call(t, "draft.set", %{"destination" => "prompt"})
  end

  test "a prompt revision is sent once; accepted, the draft clears only if it did not move on" do
    t = start()
    {t, revision} = set(t, "prompt", "  hello  ")
    {t, first} = submit(t, revision)
    assert [%{"text" => "hello"} = sent] = instructions(t, "submit")
    {t, second} = submit(t, revision)
    assert result(t, second)["code"] == "stale_revision"
    # The screen keeps typing while Pi takes the prompt.
    {t, _} = set(t, "prompt", "next")
    t = answer_driver(t, sent, %{"outcome" => "submitted", "disposition" => "queued"})
    assert %{"outcome" => "accepted", "detail" => %{"disposition" => "queued"}} = result(t, first)
    assert state(t)["drafts"]["prompt"]["text"] == "next"

    {t, revision} = set(t, "prompt", "last")
    {t, _} = submit(t, revision)

    t =
      answer_driver(t, List.last(instructions(t, "submit")), %{
        "outcome" => "submitted",
        "disposition" => "started"
      })

    assert state(t)["drafts"]["prompt"]["text"] == ""
    revision = state(t)["drafts"]["prompt"]["revision"]

    assert {_, %{"code" => "empty"}} =
             call(t, "editor.submit", %{"destination" => "prompt", "revision" => revision})
  end

  test "only the prompt is sent, and nothing while the run stops" do
    t = start()
    {t, revision} = set(t, "prompt", "x")

    assert {_, %{"code" => "invalid_arguments"}} =
             call(t, "editor.submit", %{"destination" => "assist:x", "revision" => revision})

    stopping = %{"phase" => "stopping", "compacting" => false, "retrying" => false}
    t = driver(t, %{"type" => "status", "run" => stopping})

    assert {t, %{"code" => "stopping"}} =
             submit(t, revision) |> then(fn {t, c} -> {t, result(t, c)} end)

    assert instructions(t, "submit") == []
  end

  test "a refused prompt keeps its text and may be sent again" do
    t = start()
    {t, revision} = set(t, "prompt", "x")
    {t, client} = submit(t, revision)

    t =
      answer_driver(t, hd(instructions(t, "submit")), %{
        "outcome" => "rejected",
        "code" => "stopping"
      })

    assert result(t, client)["code"] == "stopping"
    assert state(t)["drafts"]["prompt"]["text"] == "x"
    {t, again} = submit(t, revision)
    assert [_, %{"text" => "x"}] = instructions(t, "submit")
    refute replied?(t, again)
  end

  test "a screen that goes away does not end its attempt, whose late result still applies" do
    t = start()
    {t, revision} = set(t, "prompt", "gone")
    {t, client} = submit(t, revision)
    t = %{t | model: Model.drop_clients(t.model, &(&1 == client))}

    t =
      answer_driver(t, hd(instructions(t, "submit")), %{
        "outcome" => "submitted",
        "disposition" => "queued"
      })

    refute replied?(t, client)
    assert state(t)["drafts"]["prompt"]["text"] == ""
  end

  test "unknown acceptance keeps the claim and asks only to release it; a result before the release applies" do
    t = start()
    {t, revision} = set(t, "prompt", "maybe")
    {t, client} = submit(t, revision)
    sent = hd(instructions(t, "submit"))
    t = expire(t, 60_001)
    assert %{"outcome" => "unknown", "code" => "acceptance_unknown"} = result(t, client)
    request = recovery(t)
    refute Map.has_key?(request, "destination")
    assert state(t)["drafts"]["prompt"]["text"] == "maybe"

    assert {_, %{"code" => "stale_revision"}} =
             call(t, "editor.submit", %{"destination" => "prompt", "revision" => revision})

    # The late answer arrives before anybody released the claim.
    t = answer_driver(t, sent, %{"outcome" => "submitted", "disposition" => "queued"})
    assert state(t)["requests"] == []
    assert state(t)["drafts"]["prompt"]["text"] == ""
  end

  test "a refusal that arrives while acceptance is unknown releases the claim and closes the request" do
    t = start()
    {t, sent, revision} = unknown_prompt(t, "maybe")
    t = answer_driver(t, sent, %{"outcome" => "rejected", "code" => "refused"})
    assert recovery(t) == nil
    assert state(t)["drafts"]["prompt"]["text"] == "maybe"
    {t, _} = submit(t, revision)
    assert length(instructions(t, "submit")) == 2
  end

  test "releasing the claim is a write that sends nothing; a later result is only reported" do
    t = start()
    {t, sent, revision} = unknown_prompt(t, "maybe")
    assert {_, %{"code" => "not_writer"}} = release(t, "b")
    request = recovery(t)

    assert {_, %{"code" => "invalid_answer"}} =
             call(t, "request.answer", %{"request" => request["id"], "value" => "No"})

    {t, %{"outcome" => "done"}} = release(t)
    assert instructions(t, "request_closed") == []
    assert length(instructions(t, "submit")) == 1

    assert {_, %{"code" => "request_closed"}} =
             call(t, "request.answer", %{
               "request" => request["id"],
               "value" => "Release the claim"
             })

    # The same text may be sent again now, which may duplicate it.
    {t, _} = submit(t, revision)
    assert length(instructions(t, "submit")) == 2
    t = answer_driver(t, sent, %{"outcome" => "submitted", "disposition" => "queued"})
    assert Enum.any?(texts(t), &(&1 =~ "after its claim was released" and &1 =~ "twice"))
    assert state(t)["drafts"]["prompt"]["text"] == "maybe"
  end

  test "a late refusal or unknown after the release is reported, without a duplicate warning when nothing was sent again" do
    t = start()
    {t, sent, _} = unknown_prompt(t, "first")
    {t, _} = release(t)
    t = answer_driver(t, sent, %{"outcome" => "rejected", "code" => "refused"})
    assert Enum.any?(texts(t), &(&1 =~ "refused a prompt after its claim was released (refused)"))

    {t, sent, _} = unknown_prompt(t, "second")
    {t, _} = release(t)
    t = answer_driver(t, sent, %{"outcome" => "unknown", "code" => "acceptance_unknown"})
    notice = Enum.find(texts(t), &(&1 =~ "still unknown"))
    assert notice
    refute notice =~ "twice"
  end

  test "after the driver itself says acceptance is unknown, releasing lets the text be sent again" do
    t = start()
    {t, revision} = set(t, "prompt", "maybe")
    {t, client} = submit(t, revision)

    t =
      answer_driver(t, hd(instructions(t, "submit")), %{
        "outcome" => "unknown",
        "code" => "acceptance_unknown",
        "message" => "no report"
      })

    assert %{"outcome" => "unknown", "message" => "no report"} = result(t, client)
    {t, %{"outcome" => "done"}} = release(t)
    {t, _} = submit(t, revision)
    assert length(instructions(t, "submit")) == 2
  end

  test "the writer of the moment releases the claim; the one before cannot" do
    t = start()
    {t, _, _} = unknown_prompt(t, "maybe")
    t = writer(t, "b", 2)
    assert {_, %{"code" => "not_writer"}} = release(t, "a")
    assert {_, %{"outcome" => "done"}} = release(t, "b")
  end

  test "a driver request takes a supplement, answers once, and closes in the driver" do
    t = start()

    {t, id} =
      open(t, "o1", %{
        "kind" => "confirm",
        "title" => "Sure?",
        "options" => ["Yes", "No"],
        "supplement" => true
      })

    [request] = state(t)["requests"]
    destination = request["destination"]
    {t, revision} = set(t, destination, "because")
    answer = %{"request" => id, "value" => "Yes", "revision" => revision - 1}
    assert {_, %{"code" => "stale_revision"}} = call(t, "request.answer", answer)

    assert {_, %{"code" => "invalid_arguments"}} =
             call(t, "request.answer", Map.delete(answer, "revision"))

    {t, %{"outcome" => "done"}} = call(t, "request.answer", %{answer | "revision" => revision})

    assert [
             %{
               "request" => ^id,
               "answer" => %{"status" => "answered", "value" => true, "supplement" => "because"}
             }
           ] =
             instructions(t, "request_closed")

    refute Map.has_key?(state(t)["drafts"], destination)
  end

  test "a confirm's other option answers false" do
    t = start()

    {t, id} =
      open(t, "o1", %{"kind" => "confirm", "options" => ["Yes", "No"], "supplement" => false})

    {t, %{"outcome" => "done"}} = call(t, "request.answer", %{"request" => id, "value" => "No"})
    assert [%{"answer" => %{"value" => false}}] = instructions(t, "request_closed")
  end

  test "a request without a supplement is answered without a revision; stopping cancels only the driver's" do
    t = start()
    {t, plain} = open(t, "o1", %{"options" => ["a"], "supplement" => false})
    assert Enum.find(state(t)["requests"], &(&1["id"] == plain))["destination"] == nil
    {t, _, _} = unknown_prompt(t, "p")
    assert length(state(t)["requests"]) == 2
    t = op(t, "o2", %{"op" => "cancel_requests"})

    assert [%{"request" => ^plain, "answer" => %{"status" => "cancelled"}}] =
             instructions(t, "request_closed")

    assert [_] = state(t)["requests"]
    assert recovery(t)

    {t, other} = open(t, "o3", %{"options" => ["a", "b"], "supplement" => false})
    {t, %{"outcome" => "done"}} = call(t, "request.answer", %{"request" => other, "value" => "b"})

    assert %{"answer" => %{"status" => "answered", "value" => "b"} = answer} =
             List.last(instructions(t, "request_closed"))

    refute Map.has_key?(answer, "supplement")
  end

  test "the driver cancels its own requests one at a time, never the model's" do
    t = start()
    {t, id} = open(t, "o1", %{"options" => ["a"], "supplement" => true})
    t = op(t, "o2", %{"op" => "cancel_request", "request" => id})

    assert [%{"request" => ^id, "answer" => %{"status" => "cancelled"}}] =
             instructions(t, "request_closed")

    {t, _, _} = unknown_prompt(t, "p")
    t = op(t, "o3", %{"op" => "cancel_request", "request" => recovery(t)["id"]})
    assert recovery(t)
  end

  test "the driver writes open drafts, appending after a blank line, and lists the assists the model holds" do
    t = start()
    t = op(t, "o1", %{"op" => "append_draft", "destination" => "prompt", "text" => "one"})
    assert state(t)["drafts"]["prompt"]["text"] == "one"
    t = op(t, "o2", %{"op" => "append_draft", "destination" => "prompt", "text" => "two"})
    assert state(t)["drafts"]["prompt"]["text"] == "one\n\ntwo"
    t = op(t, "o3", %{"op" => "set_draft", "destination" => "prompt", "text" => "three"})
    assert %{"value" => %{"revision" => revision}} = op_result(t, "o3")
    assert state(t)["drafts"]["prompt"] == %{"text" => "three", "revision" => revision}
    t = op(t, "o4", %{"op" => "set_draft", "destination" => "request:none", "text" => "x"})
    assert %{"outcome" => "rejected", "code" => "closed_destination"} = op_result(t, "o4")
    t = op(t, "o5", %{"op" => "declare_assist", "id" => "echo", "title" => "Echo"})
    t = op(t, "o6", %{"op" => "list_assists"})
    assert %{"value" => %{"assists" => ["echo"]}} = op_result(t, "o6")
  end

  test "declarations are refused whole when one is invalid, with a notice, and withdrawn on request" do
    t = start()
    t = op(t, "o1", driver_actions(["echo.run", "Bad Id"]))
    assert %{"outcome" => "rejected", "code" => "invalid_declaration"} = op_result(t, "o1")
    assert Enum.any?(texts(t), &(&1 =~ "Bad Id"))
    refute Enum.any?(state(t)["actions"], &(&1["id"] == "echo.run"))
    t = op(t, "o2", driver_actions(["echo.run", "timeline.copy"], "screen"))
    %{"value" => %{"registration" => registration}} = op_result(t, "o2")
    assert %{"local" => true} = Enum.find(state(t)["actions"], &(&1["id"] == "timeline.copy"))
    t = op(t, "o3", driver_actions(["echo.run"]))
    assert %{"outcome" => "rejected"} = op_result(t, "o3")
    t = op(t, "o4", %{"op" => "present", "kind" => "tool", "renderer" => "tool.generic"})
    t = op(t, "o5", %{"op" => "present", "kind" => "tool", "renderer" => "other"})
    assert %{"outcome" => "rejected"} = op_result(t, "o5")
    assert state(t)["kinds"] == %{"tool" => "tool.generic"}
    t = op(t, "o6", %{"op" => "withdraw", "registration" => registration})
    refute Enum.any?(state(t)["actions"], &(&1["id"] in ["echo.run", "timeline.copy"]))
    refute Map.has_key?(state(t)["keys"], "timeline.copy")
  end

  test "keys apply once the driver is ready, and problems become notices once" do
    t =
      op(fresh(), "o1", %{
        "op" => "declare_actions",
        "actions" => [
          %{
            "id" => "timeline.cursor_down",
            "class" => "view",
            "keys" => ["j"],
            "runs" => "screen"
          }
        ]
      })

    assert state(t)["keys"] == %{}

    t =
      driver(t, %{
        "type" => "ready",
        "session" => @session,
        "keys" => %{"global.stop" => "j", "timeline.cursor_down" => "nosuchkey"}
      })

    assert state(t)["keys"]["editor.submit"] == ["return", "kpenter"]
    assert state(t)["keys"]["timeline.cursor_down"] == []
    assert Enum.count(texts(t), &(&1 =~ "nosuchkey")) == 1
    assert Enum.any?(texts(t), &(&1 =~ "global.stop"))
    t = op(t, "o2", driver_actions(["global.stop"]))
    assert state(t)["keys"]["global.stop"] == ["j"]
    assert Enum.count(texts(t), &(&1 =~ "nosuchkey")) == 1

    assert {_, [{:fail, _}]} =
             Model.driver_record(t.model, %{"type" => "ready", "session" => @session}, 0)
  end

  test "an assist follows its draft; a stale or withdrawn result is discarded; accepting runs the candidate's action" do
    t = start([{"d", driver_actions(["echo.run"])}])
    t = op(t, "o1", %{"op" => "declare_assist", "id" => "echo", "title" => "Echo"})
    %{"value" => %{"registration" => registration}} = op_result(t, "o1")
    [first] = instructions(t, "query_assist")
    assert first["text"] == ""
    {t, revision} = set(t, "assist:echo", "new")
    [_, second] = instructions(t, "query_assist")

    candidate = %{
      "id" => "only",
      "label" => "x",
      "action" => %{"id" => "echo.run", "args" => %{"text" => "new"}}
    }

    t = answer_driver(t, first, %{"outcome" => "candidates", "candidates" => [candidate]})
    accept = %{"assist" => "echo", "candidate" => "only", "revision" => revision}
    assert {_, %{"code" => "stale_revision"}} = call(t, "assist.accept", accept)
    t = answer_driver(t, second, %{"outcome" => "candidates", "candidates" => [candidate]})
    assert hd(state(t)["assists"])["revision"] == revision
    {t, client} = invoke(t, "assist.accept", accept, "b")
    [run] = instructions(t, "run_action")
    assert run["args"] == %{"text" => "new"} and run["writer"] == false
    t = answer_driver(t, run, %{"outcome" => "done", "detail" => 3})
    assert %{"outcome" => "done", "detail" => 3} = result(t, client)
    # A withdrawn assist's draft goes, and its late candidates are dropped.
    {t, _} = set(t, "assist:echo", "newer")
    t = op(t, "o2", %{"op" => "withdraw", "registration" => registration})

    t =
      answer_driver(t, List.last(instructions(t, "query_assist")), %{
        "outcome" => "rejected",
        "code" => "unknown_assist"
      })

    assert state(t)["assists"] == []
    refute Map.has_key?(state(t)["drafts"], "assist:echo")
    refute Enum.any?(texts(t), &(&1 =~ "assist echo"))
  end

  test "a candidate is checked as its own action, and accepting never accepts another candidate" do
    t = start([{"d", driver_actions(["echo.write"], "driver", "write")}])
    t = op(t, "o1", %{"op" => "declare_assist", "id" => "echo", "title" => "Echo"})
    [query] = instructions(t, "query_assist")
    revision = state(t)["drafts"]["assist:echo"]["revision"]

    candidates = [
      %{"id" => "write", "label" => "w", "action" => %{"id" => "echo.write"}},
      %{
        "id" => "loop",
        "label" => "l",
        "action" => %{
          "id" => "assist.accept",
          "args" => %{"assist" => "echo", "candidate" => "loop", "revision" => revision}
        }
      }
    ]

    t = answer_driver(t, query, %{"outcome" => "candidates", "candidates" => candidates})
    accept = &%{"assist" => "echo", "candidate" => &1, "revision" => revision}
    assert {_, %{"code" => "not_writer"}} = call(t, "assist.accept", accept.("write"), "b")
    assert {t, %{"code" => "invalid_candidate"}} = call(t, "assist.accept", accept.("loop"))
    assert instructions(t, "run_action") == []
  end

  test "an assist declared again never repeats its predecessor's revisions, so a screen's stale edit and acceptance are refused" do
    t = start([{"d", driver_actions(["echo.run"])}])
    t = op(t, "o1", %{"op" => "declare_assist", "id" => "echo", "title" => "Echo"})

    candidate = fn text ->
      %{"id" => "only", "label" => text, "action" => %{"id" => "echo.run", "args" => text}}
    end

    t =
      answer_driver(t, List.last(instructions(t, "query_assist")), %{
        "outcome" => "candidates",
        "candidates" => [candidate.("OLD")]
      })

    seen = hd(state(t)["assists"])

    t =
      op(t, "o2", %{
        "op" => "withdraw",
        "registration" => op_result(t, "o1")["value"]["registration"]
      })

    t = op(t, "o3", %{"op" => "declare_assist", "id" => "echo", "title" => "Echo"})

    t =
      answer_driver(t, List.last(instructions(t, "query_assist")), %{
        "outcome" => "candidates",
        "candidates" => [candidate.("NEW")]
      })

    # The screen still shows the first assist's candidates and draft.
    assert {_, %{"code" => "stale_revision"}} =
             call(t, "assist.accept", %{
               "assist" => "echo",
               "candidate" => "only",
               "revision" => seen["revision"]
             })

    assert {t, %{"code" => "stale_revision"}} =
             call(t, "draft.set", %{
               "destination" => "assist:echo",
               "text" => "x",
               "base" => seen["revision"]
             })

    assert instructions(t, "run_action") == []
  end

  test "driver actions are answered by the driver, unknown after the deadline, and a late answer is dropped" do
    t = start([{"d", driver_actions(["global.compact"])}])
    {t, client} = invoke(t, "global.compact")
    run = hd(instructions(t, "run_action"))
    t = expire(t, 60_001)
    assert %{"outcome" => "unknown"} = result(t, client)
    t = answer_driver(t, run, %{"outcome" => "done"})
    assert Enum.count(t.out, &match?({:reply, ^client, _}, &1)) == 1

    assert {_, [{:fail, "uncorrelated_runtime_record"}]} =
             Model.driver_record(
               t.model,
               %{"type" => "result", "id" => "m999", "result" => %{"outcome" => "done"}},
               0
             )
  end

  test "a waiting driver action is answered when its write is refused or the driver ends" do
    t = start([{"d", driver_actions(["global.compact"])}])
    {t, client} = invoke(t, "global.compact")
    run = hd(instructions(t, "run_action"))

    assert {_, [{:reply, ^client, %{"code" => "engine_write_rejected"}}]} =
             Model.write_rejected(t.model, run["id"])

    assert {_, [{:reply, ^client, %{"outcome" => "unknown"}}]} =
             Model.failed(t.model, "engine_exited")
  end

  test "a screen action is the screen's to run" do
    t = start([{"d", driver_actions(["timeline.copy"], "screen")}])
    assert {_, %{"code" => "screen_action"}} = call(t, "timeline.copy")
  end

  test "the model's notices follow the driver entry that was last, also when the driver reorders" do
    t = start()

    entry = fn id ->
      %{"kind" => "notice", "id" => id, "version" => 0, "level" => "info", "text" => id}
    end

    t = driver(t, %{"type" => "entries", "entries" => [entry.("notice-0")]})
    t = op(t, "o1", driver_actions(["Bad"]))
    notice = Enum.find(state(t)["items"], &(&1["text"] =~ "Bad"))["id"]
    t = driver(t, %{"type" => "entries", "entries" => [entry.("notice-1")]})
    assert ["notice-0", notice, "notice-1"] == Enum.map(state(t)["items"], & &1["id"])

    t =
      driver(t, %{
        "type" => "entries",
        "entries" => [entry.("notice-2")],
        "order" => ["notice-1", "notice-2", "notice-0"]
      })

    assert ["notice-1", "notice-2", "notice-0", notice] == Enum.map(state(t)["items"], & &1["id"])
  end

  test "entries the model cannot follow fail the agent" do
    t = start()

    fails = fn record ->
      assert {_, [{:fail, "invalid_runtime_record"}]} = Model.driver_record(t.model, record, 0)
    end

    entry = %{
      "kind" => "notice",
      "id" => "notice-0",
      "version" => 0,
      "level" => "info",
      "text" => "x"
    }

    # An order that does not list every entry once.
    fails.(%{"type" => "entries", "entries" => [entry], "order" => []})
    # An id in the model's own space.
    t2 = op(t, "o1", driver_actions(["Bad"]))
    own = Enum.find(state(t2)["items"], &(&1["text"] =~ "Bad"))["id"]

    assert {_, [{:fail, "invalid_runtime_record"}]} =
             Model.driver_record(
               t2.model,
               %{"type" => "entries", "entries" => [%{entry | "id" => own}]},
               0
             )

    # A tool whose parent is itself, a parent that is unknown, or a cycle of parents.
    fails.(%{"type" => "entries", "entries" => [tool("t", %{"parentId" => "t"})]})
    fails.(%{"type" => "entries", "entries" => [tool("t", %{"parentId" => "nowhere"})]})

    fails.(%{
      "type" => "entries",
      "entries" => [tool("a", %{"parentId" => "b"}), tool("b", %{"parentId" => "a"})]
    })

    # A nested call under its parent is followed.
    t =
      driver(t, %{"type" => "entries", "entries" => [tool("p"), tool("c", %{"parentId" => "p"})]})

    assert [%{"data" => %{"calls" => [%{"name" => "read"}]}}, %{"parentId" => "p"}] =
             state(t)["items"]
  end

  test "an ended driver answers whoever waits as unknown and changes nothing on screen" do
    t = start()
    {t, revision} = set(t, "prompt", "x")
    {t, client} = submit(t, revision)
    before = Model.snapshot(t.model)
    {model, out} = Model.failed(t.model, "engine_exited")
    assert [{:reply, ^client, %{"outcome" => "unknown", "message" => message}}] = out
    assert message =~ "engine_exited"
    assert broadcasts(out) == []
    assert Model.snapshot(model) == before
  end
end
