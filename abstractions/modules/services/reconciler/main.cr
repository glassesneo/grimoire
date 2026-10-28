require "./reconciler"

if ARGV == ["--help"]
  puts "Usage: hjem-services-reconcile CLOSURE HOME NIX_STORE"
  exit
end
begin
  raise "Expected CLOSURE HOME NIX_STORE (see --help)" unless ARGV.size == 3
  HjemServices.reconcile(Path[ARGV[0]], Path[ARGV[1]], ARGV[2], HjemServices::Launchctl.new)
rescue error
  STDERR.puts "Hjem services: #{error.message}"
  exit 1
end
