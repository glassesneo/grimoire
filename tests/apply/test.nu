use std/assert

# Runs `all` against a remote target and returns its result and the calls made.
def apply [script: string, environment: record]: nothing -> record {
  let calls = mktemp --tmpdir
  let result = with-env ($environment | merge {CALLS: $calls}) {
    ^nu --no-config-file -c $"use ($script) *; all fixture --target remote" | complete
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
  # Each built path reaches the command that uses it.
  let built = $calls | where {|call| $call | str contains ".preflight" } | first | split row ' ' | where {|arg| $arg | str contains '#' } | each {|attr| $"/nix/store/fake-($attr | hash md5)" }
  let activation = $calls | where {|call| $call | str contains "standalone switch" } | first
  assert str contains $activation $"($built.2)/bin/hjem standalone switch"
  assert str contains $activation $"($built.1)/bin/apply"

  for with_path in ["" "1"] {
    let failed = apply $script {FAIL_ON: ".preflight", FAIL_WITH_PATH: $with_path}
    assert not equal $failed.exit_code 0
    assert str contains $failed.stderr "Hjem build failed"
    # nix-darwin was activated before Hjem preflight, and nothing after it ran.
    index-of $failed.calls "/activate" | ignore
    assert ($failed.calls | last | str contains ".preflight")
  }
}
