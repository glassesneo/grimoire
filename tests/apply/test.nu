use std/assert

def apply [script: string, environment: record]: nothing -> record {
  let calls = mktemp --tmpdir
  let selection = if "SOURCE" in $environment { $" --flake ($environment.SOURCE)" } else { "" }
  let result = with-env ($environment | merge {CALLS: $calls}) {
    ^nu --no-config-file -c $"use ($script) *; all fixture --target remote($selection)" | complete
  }
  $result | merge {calls: (open --raw $calls | lines)}
}

def index-of [calls: list<string>, pattern: string]: nothing -> int {
  let found = $calls | enumerate | where {|call| $call.item | str contains $pattern }
  assert ($found | is-not-empty) $"missing call: ($pattern)"
  $found | first | get index
}

def main [script: string] {
  let applied = apply $script {}
  assert equal $applied.exit_code 0 $applied.stderr
  let calls = $applied.calls
  let order = [darwinConfigurations "/activate" ".preflight" "standalone switch"] | each {|pattern| index-of $calls $pattern }
  assert equal $order ($order | sort)
  let built = $calls | where {|call| $call | str contains ".preflight" } | first | split row ' ' | where {|arg| $arg | str contains '#' } | each {|attr| $"/nix/store/fake-($attr | hash md5)" }
  let activation = $calls | where {|call| $call | str contains "standalone switch" } | first
  assert str contains $activation $"($built.2)/bin/hjem standalone switch"
  assert str contains $activation $"($built.1)/bin/apply"

  let source = "/nix/store/0123456789abcdefghijklmnopqrstuv-source"
  let candidate = apply $script {SOURCE: $source}
  assert equal $candidate.exit_code 0 $candidate.stderr
  for pattern in [darwinConfigurations ".preflight" "flake metadata" "flake archive"] {
    let i = index-of $candidate.calls $pattern
    assert str contains ($candidate.calls | get $i) $"path:($source)"
  }
  let activated = index-of $candidate.calls "standalone switch"
  assert str contains ($candidate.calls | get $activated) $"--flake ($source)"

  for with_path in ["" "1"] {
    let failed = apply $script {FAIL_ON: ".preflight", FAIL_WITH_PATH: $with_path}
    assert not equal $failed.exit_code 0
    assert str contains $failed.stderr "Hjem build failed"
    index-of $failed.calls "/activate" | ignore
    assert ($failed.calls | last | str contains ".preflight")
  }
}
