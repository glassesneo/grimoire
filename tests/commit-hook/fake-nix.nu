use std/assert

# The full gate on a sent tree: the system, the check names, then each check.
def push [args: list<string>] {
  let marker = open --raw push-marker
  assert ($marker in ["one\n" "two\n"])
  assert (not ('dirty-only' | path exists))
  assert equal (open --raw sample.nix) "original\n"
  match $args.0 {
    eval => {
      if '--raw' in $args { print 'test-system' } else {
        assert equal $args [eval --json --no-update-lock-file 'path:.#lib.checks.test-system.checkNames']
        ['selected.case' formatting] | to json | print
      }
    }
    build => {
      let name = $args | last | parse 'path:.#checks.test-system.{name}' | get 0.name | from json
      assert equal $args [build --no-link --no-update-lock-file $"path:.#checks.test-system.($name | to json --raw)"]
      mkdir $env.CHECK_BUILDS
      touch ($env.CHECK_BUILDS | path join $"($marker | str trim)-($name)")
      if $name == formatting { $marker | save --append $env.PUSH_CONTENTS }
      if ($env.FAIL_CHECK? | is-not-empty) { exit 1 }
    }
    _ => { error make {msg: $"Unexpected Nix command in the push gate: ($args.0)"} }
  }
}

# Runs inside the hook's index snapshot, which is not a Git repository.
def --wrapped main [...args: string] {
  do --capture-errors {
    let command = $args.0
    # The pre-push snapshot is a sent tree; only those trees hold push-marker.
    let push = 'push-marker' | path exists
    let check = $command == build and ($args | any {|arg| $arg | str contains '#checks.' })
    # Checks build concurrently and appends can race; the snapshot is also
    # recorded by the evaluations before them, and push checks by name.
    if not ($push and $check) { $"($command)\n" | save --append $env.NIX_CALLS }
    if not $check { $"($env.PWD)\n" | save --append $env.SNAPSHOTS }
    # Every invocation reads a settled snapshot: no mtime after the fixed one.
    assert equal (^find . -newermt '@1' | lines) []
    if $push { push $args; return }
    match $command {
      fmt => {
        "formatted\n" | save --force sample.nix
        "created by hook\n" | save --force hook-new.txt
        rm --force obsolete.txt
        if ($env.FAIL_FMT? | is-not-empty) { exit 1 }
      }
      eval => {
        assert equal (open --raw sample.nix) "formatted\n"
        assert equal (open --raw docs/generated/authoring.md) "generated reference\n"
        if '--raw' in $args { print 'test-system' } else {
          let selective = $env.SELECTIVE? | is-not-empty
          let roots = if $selective {
            [sample.nix obsolete.txt user-change.txt hook-new.txt] | each {|path|
              {name: $path, directory: $path, infrastructure: false, affectedChecks: (if $path == 'hook-new.txt' { ['selected.case'] } else { [] })}
            }
          } else { [] }
          let names = if ($env.ZERO_CHECKS? | is-not-empty) { [] } else if $selective { ['selected.case' unselected] } else if ($env.MANY_CHECKS? | is-not-empty) { ['selected.case' second third] } else { ['selected.case'] }
          {moduleRoots: $roots, directoryChecks: [], hostChecks: [], checkNames: ($names ++ [formatting authoring-docs])} | to json | print
        }
      }
      build => {
        if ($args | any {|arg| $arg | str contains '#checks.' }) {
          let name = $args | last | parse 'path:.#checks.test-system.{name}' | get 0.name | from json
          assert equal $args [build --no-link --no-update-lock-file $"path:.#checks.test-system.($name | to json --raw)"]
          # Checks build concurrently: one file each, since appends can race.
          mkdir $env.CHECK_BUILDS
          touch ($env.CHECK_BUILDS | path join $name)
          assert equal (open --raw sample.nix) "formatted\n"
          assert equal (open --raw docs/generated/authoring.md) "generated reference\n"
          assert equal (open --raw other.txt) $env.EXPECT_OTHER
          assert (not ('later.txt' | path exists))
          assert (not ('ignored' | path exists))
          if ($env.FAIL_CHECK? | is-not-empty) or ($env.FAIL_ONLY? == $name) { exit 1 }
          return
        }
        let reference = mktemp --tmpdir
        "generated reference\n" | save --force $reference
        print $reference
      }
      _ => { error make {msg: $"Unexpected Nix command: ($command)"} }
    }
  }
}
