# The `shield` executable; see shield_cli.cr.
require "./shield_cli"

begin
  Shield.main(ARGV)
rescue error
  STDERR.puts "shield: #{error.message}"
  exit 1
end
