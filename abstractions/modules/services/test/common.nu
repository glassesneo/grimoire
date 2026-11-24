export def eventually [description: string, condition: closure] {
  for _ in 0..<100 {
    if (do $condition) { return }
    sleep 100ms
  }
  error make {msg: $"Timed out: ($description)"}
}

export def lines-of [file: path]: nothing -> list<string> {
  if ($file | path exists) { open --raw $file | lines } else { [] }
}
