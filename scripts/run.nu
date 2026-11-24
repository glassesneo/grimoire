# Standard output stays out of the error, since it may carry secrets.
export def --wrapped checked [command: string, ...args: string]: any -> string {
  let result = $in | run-external $command ...$args | complete
  if $result.exit_code != 0 {
    error make {msg: $"($command) ($args | str join ' ') failed: ($result.stderr)"}
  }
  $result.stdout | str trim
}
