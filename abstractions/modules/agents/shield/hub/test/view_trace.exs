:io.setopts(:standard_io, encoding: :unicode)
events = File.read!("test/view-trace.json") |> JSON.decode!()

{_, views} =
  Enum.reduce(events, {Shield.PiView.new(), []}, fn event, {view, views} ->
    next = Shield.PiView.apply(view, event, 1000)
    {next, [next | views]}
  end)

IO.puts(JSON.encode!(Enum.reverse(views)))
