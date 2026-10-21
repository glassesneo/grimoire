# The keel engine between the Agent and the model: what it gives the Agent for attaches before
# and after the driver is ready, for records that do not conform, and when the driver ends.
defmodule Shield.KeelTest do
  use ExUnit.Case, async: true
  alias Shield.Keel
  alias Shield.Keel.Model

  @state Path.expand("../../contracts/state.json", __DIR__) |> File.read!() |> JSON.decode!()
  @session %{"id" => "session-1", "cwd" => "/project", "model" => "faux/faux", "thinking" => nil}
  @ready %{"type" => "ready", "session" => @session}

  defp engine, do: Keel.init(%{config_dir: "/config"}) |> elem(0)
  defp ref(id), do: %{pid: self(), id: id}

  test "the shared state fixture the screen tests start from is what the model publishes" do
    {model, _} = Model.driver_record(Model.new("model-1"), @ready, 0)
    assert Model.snapshot(model) == @state["snapshot"]
  end

  test "an attach before the driver is ready gets its snapshot after the ready step's event" do
    s = engine()
    {s, []} = Keel.attach(s, ref("c1"), %{"id" => "a"}, %{"configDir" => "/config"})
    {_, effects} = Keel.output(s, @ready, 0)
    ready_at = Enum.find_index(effects, &(&1 == {:ready}))

    snapshot_at =
      Enum.find_index(effects, &match?({:snapshot, %{id: "c1"}, %{"id" => "a"}, _}, &1))

    assert ready_at < snapshot_at
    {:snapshot, _, _, snapshot} = Enum.at(effects, snapshot_at)

    for {{:broadcast, event}, at} <- Enum.with_index(effects) do
      assert at < snapshot_at
      assert event["seq"] <= snapshot["seq"]
    end
  end

  test "an attach with another configuration directory is refused" do
    assert {_, [{:error, _, _, "config_dir_mismatch"}]} =
             Keel.attach(engine(), ref("c1"), %{"id" => "a"}, %{"configDir" => "/other"})
  end

  test "a driver record or screen request that does not conform is refused" do
    {s, _} = Keel.output(engine(), @ready, 0)
    assert {_, [{:fail, "invalid_runtime_record"}]} = Keel.output(s, %{"type" => "entries"}, 0)

    request = %{"id" => "r", "payload" => %{"op" => "invoke", "action" => 1}}
    assert {_, [{:error, _, ^request, "invalid_request"}]} = Keel.input(s, ref("c1"), request, 0)
  end

  test "when the driver ends, a waiting attach is answered with the reason" do
    {s, []} = Keel.attach(engine(), ref("c1"), %{"id" => "a"}, %{"configDir" => "/config"})

    assert {_, [{:error, %{id: "c1"}, %{"id" => "a"}, "engine_exited"}]} =
             Keel.failed(s, "engine_exited")
  end
end
