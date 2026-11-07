require "./reconciler"

if ARGV == ["--help"]
  puts "Usage: hjem-defaults-reconcile CLOSURE HOME RESTART"
  exit
end
begin
  raise "Expected CLOSURE HOME RESTART (see --help)" unless ARGV.size == 3
  HjemDefaults.reconcile(Path[ARGV[0]], Path[ARGV[1]], HjemDefaults::Preferences.new, HjemDefaults::Commands.new(ARGV[2]))
rescue error
  STDERR.puts "Hjem defaults: #{error.message}"
  exit 1
end
