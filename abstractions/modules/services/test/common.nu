# Helpers shared by the services module's test scripts.

# Polls CONDITION every 100ms for up to ten seconds.
export def eventually [description: string, condition: closure] {
  for _ in 0..<100 {
    if (do $condition) { return }
    sleep 100ms
  }
  error make {msg: $"Timed out: ($description)"}
}

# The lines of FILE, or none when it does not exist.
export def lines-of [file: path]: nothing -> list<string> {
  if ($file | path exists) { open --raw $file | lines } else { [] }
}
