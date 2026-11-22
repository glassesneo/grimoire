use std/assert

def try-import [script: string, checkout: string, source: string, fail: string = ""] {
  with-env {SOURCE: $source, FAIL_COPY: $fail, CHECKOUT: $checkout} {
    ^nu --no-config-file -c $"use ($script) *; import-candidate vm $env.CHECKOUT" | complete
  }
}

def main [script: string] {
  let checkout = $env.TMPDIR | path join "checkout's files"
  mkdir $checkout
  ^git -C $checkout init --quiet
  let first = "/nix/store/0123456789abcdefghijklmnopqrstuv-source"
  let next = "/nix/store/1123456789abcdefghijklmnopqrstuv-source"
  let root = $env.XDG_STATE_HOME | path join grimoire latest-candidate

  "fixture" | save ($checkout | path join flake.nix)
  let blocked = try-import $script $checkout $first
  assert not equal $blocked.exit_code 0
  assert equal $blocked.stdout ""
  assert str contains $blocked.stderr "untracked files"
  assert str contains $blocked.stderr "flake.nix"
  assert (not ($root | path exists))

  ^git -C $checkout add flake.nix
  let imported = try-import $script $checkout $first
  assert equal $imported.exit_code 0 $imported.stderr
  assert equal $imported.stdout $"($first)\n"
  assert equal (^readlink $root | str trim) $first

  let failed = try-import $script $checkout $next "1"
  assert not equal $failed.exit_code 0
  assert equal $failed.stdout ""
  assert equal (^readlink $root | str trim) $first

  let replaced = try-import $script $checkout $next
  assert equal $replaced.exit_code 0 $replaced.stderr
  assert equal $replaced.stdout $"($next)\n"
  assert equal (^readlink $root | str trim) $next
}
