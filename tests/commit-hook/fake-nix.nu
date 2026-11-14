use std/assert

def flag [args: list<string>, name: string] {
  $args | get (($args | enumerate | where item == $name | get 0.index) + 1)
}

# nix-fast-build receives the check names through --select, runs CHECK on
# each, writes its result file and exits nonzero on any failure, as the real
# tool does. FAST_BUILD_CRASH fails before any result is written, and
# FAST_BUILD_OMIT leaves a check out of the results, as a wrong selection does.
def fast-build [args: list<string>, check: closure] {
  let select = flag $args '--select'
  let results = flag $args '--result-file'
  # Scheduling remains explicit even when Nix disables local builds; the
  # runner must not change the Nix setting to obtain its own workers.
  assert equal $env.NIX_CONFIG 'max-jobs = 0'
  assert equal $args [fast-build --no-nom --max-jobs '4' --eval-workers '4' --flake 'path:.#checks.test-system' --select $select --result-file $results]
  if ($env.FAST_BUILD_CRASH? | is-not-empty) { exit 1 }
  let names = $select | parse --regex "fromJSON ''(?<json>.*)''" | get 0.json | from json | where {|name| $name != $env.FAST_BUILD_OMIT? }
  let entries = $names | each {|name|
    let success = do $check $name
    {type: BUILD, attr: $name, success: $success, error: (if $success { null } else { 'build exited with 1' })}
  }
  {results: $entries} | to json | save --force $results
  if ($entries | any {|entry| not $entry.success }) { exit 1 }
}

# The full gate on a sent tree: the system, the check names, then every check.
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
    fast-build => {
      fast-build $args {|name|
        mkdir $env.CHECK_BUILDS
        touch ($env.CHECK_BUILDS | path join $"($marker | str trim)-($name)")
        if $name == formatting { $marker | save --append $env.PUSH_CONTENTS }
        $env.FAIL_CHECK? | is-empty
      }
    }
    _ => { error make {msg: $"Unexpected Nix command in the push gate: ($args.0)"} }
  }
}

# Runs inside the hook's index snapshot, which is not a Git repository.
def --wrapped main [...args: string] {
  do --capture-errors {
    let command = $args.0
    $"($command)\n" | save --append $env.NIX_CALLS
    $"($env.PWD)\n" | save --append $env.SNAPSHOTS
    # The pre-push snapshot is a sent tree; only those trees hold push-marker.
    if ('push-marker' | path exists) { push $args; return }
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
              {name: $path, directory: $path, affectedChecks: (if $path == 'hook-new.txt' { ['selected.case'] } else { [] })}
            }
          } else { [] }
          let names = if ($env.ZERO_CHECKS? | is-not-empty) { [] } else if $selective { ['selected.case' unselected] } else if ($env.MANY_CHECKS? | is-not-empty) { ['selected.case' second third] } else { ['selected.case'] }
          {moduleRoots: $roots, directoryChecks: [], hostChecks: [], checkNames: ($names ++ [formatting authoring-docs])} | to json | print
        }
      }
      fast-build => {
        fast-build $args {|name|
          mkdir $env.CHECK_BUILDS
          touch ($env.CHECK_BUILDS | path join $name)
          assert equal (open --raw sample.nix) "formatted\n"
          assert equal (open --raw docs/generated/authoring.md) "generated reference\n"
          assert equal (open --raw other.txt) $env.EXPECT_OTHER
          assert (not ('later.txt' | path exists))
          assert (not ('ignored' | path exists))
          ($env.FAIL_CHECK? | is-empty) and ($env.FAIL_ONLY? != $name)
        }
      }
      build => {
        let reference = mktemp --tmpdir
        "generated reference\n" | save --force $reference
        print $reference
      }
      _ => { error make {msg: $"Unexpected Nix command: ($command)"} }
    }
  }
}
