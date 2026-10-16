# Pi owns argv, requested identity and environment isolation. A wrong argv or ID can
# open the wrong history; a hub-only credential override breaks creator isolation.
# These pure adapter tests cover those outcomes, not Pi's own file/fork implementation.
defmodule Shield.PiLaunchTest do
  use ExUnit.Case
  alias Shield.Pi
  @id "11111111-1111-4111-8111-111111111111"

  defp options(session) do
    %{
      "mode" => "live",
      "model" => "saved/choice",
      "session" => session,
      "launch" => %{
        "executable" => "/bin/sh",
        "argv" => ["--session-dir", "/tmp/fixture", "--model", "saved/choice"],
        "env" => %{"CMD_API_KEY" => "creator", "PATH" => "/fixture/bin"}
      }
    }
  end

  test "new, resume and fork use Pi's distinct session flags" do
    for {kind, expected} <- [
          {"new", ["--session-id", @id]},
          {"resume", ["--session", __ENV__.file]},
          {"fork", ["--fork", __ENV__.file, "--session-id", @id]}
        ] do
      o = options(%{"kind" => kind, "id" => @id, "path" => __ENV__.file})
      assert {:ok, launch} = Pi.launch(o, System.tmp_dir!(), @id)
      assert launch.descriptor["argv"] == o["launch"]["argv"] ++ expected
      assert launch.model == "saved/choice"
      assert launch.session_id == @id
    end

    for session <- [
          nil,
          %{"kind" => "new", "id" => "../bad"},
          %{"kind" => "resume", "id" => @id, "path" => "relative"}
        ] do
      assert {:error, "invalid_session"} = Pi.launch(options(session), System.tmp_dir!(), @id)
    end
  end

  test "resume preserves Pi-valid saved IDs that are not UUIDs" do
    session = %{"kind" => "resume", "id" => "saved_session.v1", "path" => __ENV__.file}
    assert {:ok, launch} = Pi.launch(options(session), "/tmp", "saved_session.v1")
    assert launch.session_id == "saved_session.v1"
    assert Enum.take(launch.descriptor["argv"], -2) == ["--session", __ENV__.file]
  end

  test "launch uses creator credentials and unsets hub-only variables" do
    keys = ~w(CMD_API_KEY COMMAND_CODE_API_KEY SHIELD_TEST_HUB_ONLY)
    previous = Map.take(System.get_env(), keys)
    Enum.each(keys, &System.put_env(&1, "hub"))

    on_exit(fn ->
      Enum.each(keys, &System.delete_env/1)
      System.put_env(previous)
    end)

    assert {:ok, launch} = Pi.launch(options(%{"kind" => "new", "id" => @id}), "/tmp", @id)
    assert launch.descriptor["env"]["CMD_API_KEY"] == "creator"
    assert launch.descriptor["env"]["COMMAND_CODE_API_KEY"] == false
    assert launch.descriptor["env"]["SHIELD_TEST_HUB_ONLY"] == false
    assert launch.descriptor["env"]["PATH"] == "/fixture/bin"
  end

  test "reattach does not replace the running model or launch environment" do
    {s, _} = Pi.init(%{model: "saved/choice", mode: "live", session_id: @id})
    s = %{s | initializing: false}
    r = %{"id" => "attach"}
    changed = options(%{"kind" => "new", "id" => @id}) |> Map.put("model", "other/model")
    assert {^s, [{:subscribe, _, ^r}]} = Pi.attach(s, %{pid: self()}, r, changed)
  end

  test "initialization refuses a different session ID or unavailable selected model" do
    for {actual_id, available, failure} <- [
          {"wrong", true, "session_id_mismatch"},
          {@id, false, "model_unavailable_or_initialization_not_idle"}
        ] do
      {s, _} = Pi.init(%{model: "saved/choice", mode: "live", session_id: @id})
      model = %{"provider" => "saved", "id" => "choice"}

      data = [
        %{"entries" => [], "leafId" => nil},
        %{
          "sessionId" => actual_id,
          "model" => model,
          "isStreaming" => false,
          "isCompacting" => false,
          "pendingMessageCount" => 0
        },
        %{"models" => if(available, do: [model], else: [])}
      ]

      {_, effects} =
        Enum.with_index(data)
        |> Enum.reduce({s, []}, fn {d, i}, {s, _} ->
          Pi.output(
            s,
            %{"type" => "response", "id" => "shield:#{i}", "success" => true, "data" => d},
            1000
          )
        end)

      assert effects == [{:fail, failure}]
    end
  end
end
