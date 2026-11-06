use std/assert

# Runs inside the hook's index snapshot, which is not a Git repository.
def --wrapped main [...args: string] {
  do --capture-errors {
    let command = $args.0
    $"($command)\n" | save --append $env.NIX_CALLS
    $"($env.PWD)\n" | save --append $env.SNAPSHOTS
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
          {moduleRoots: $roots, directoryChecks: [], checkNames: ($names ++ [formatting authoring-docs])} | to json | print
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
      flake => {
        assert equal $args [flake check path:. --no-update-lock-file]
        let marker = open --raw push-marker
        assert ($marker in ["one\n" "two\n"])
        $marker | save --append $env.PUSH_CONTENTS
        assert (not ('dirty-only' | path exists))
        assert equal (open --raw sample.nix) "original\n"
        if ($env.FAIL_CHECK? | is-not-empty) { exit 1 }
      }
      _ => { error make {msg: $"Unexpected Nix command: ($command)"} }
    }
  }
}
