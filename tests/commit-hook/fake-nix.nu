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
          {moduleRoots: $roots, directoryChecks: [], checkNames: (if ($env.ZERO_CHECKS? | is-not-empty) { [formatting authoring-docs] } else if $selective { ['selected.case' unselected formatting authoring-docs] } else { ['selected.case' formatting authoring-docs] })} | to json | print
        }
      }
      build => {
        if ($args | any {|arg| $arg | str contains '#checks.' }) {
          assert equal $args [build --no-link --no-update-lock-file 'path:.#checks.test-system."selected.case"']
          assert equal (open --raw sample.nix) "formatted\n"
          assert equal (open --raw docs/generated/authoring.md) "generated reference\n"
          assert equal (open --raw other.txt) $env.EXPECT_OTHER
          assert (not ('later.txt' | path exists))
          assert (not ('ignored' | path exists))
          if ($env.FAIL_CHECK? | is-not-empty) { exit 1 }
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
