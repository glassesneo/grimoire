require "./reconciler"

if ARGV == ["--help"]
  puts "Usage: hjem-defaults-reconcile CLOSURE HOME"
  exit
end
begin
  raise "Expected CLOSURE HOME (see --help)" unless ARGV.size == 2
  HjemDefaults.reconcile(Path[ARGV[0]], Path[ARGV[1]], HjemDefaults::Preferences.new)
rescue error
  STDERR.puts "Hjem defaults: #{error.message}"
  exit 1
end
