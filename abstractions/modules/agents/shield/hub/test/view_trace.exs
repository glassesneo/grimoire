:io.setopts(:standard_io, encoding: :unicode)
events = File.read!("test/view-trace.json") |> JSON.decode!()

{_, frames} =
  Enum.reduce(events, {Shield.PiView.new(), []}, fn event, {view, frames} ->
    next = Shield.PiView.apply(view, event, 1000)

    frame = %{
      record: event,
      patch: Shield.PiView.patch(view, next),
      snapshot: Shield.PiView.snapshot(next)
    }

    {next, [frame | frames]}
  end)

IO.puts(JSON.encode!(Enum.reverse(frames)))
