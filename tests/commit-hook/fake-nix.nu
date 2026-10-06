use std/assert

# Runs inside the hook's index snapshot, which is not a Git repository.
def --wrapped main [...args: string] {
  do --capture-errors {
    let command = $args.0
    $"($command)\n" | save --append $env.NIX_CALLS
    match $command {
      fmt => {
        "formatted\n" | save --force sample.nix
        "created by hook\n" | save --force hook-new.txt
        rm --force obsolete.txt
        if ($env.FAIL_FMT? | is-not-empty) { exit 1 }
      }
      build => {
        let catalogue = mktemp --tmpdir
        "generated catalogue\n" | save --force $catalogue
        print $catalogue
      }
      flake => {
        assert equal (open --raw sample.nix) "formatted\n"
        assert equal (open --raw docs/generated/modules.md) "generated catalogue\n"
        assert equal (open --raw other.txt) $env.EXPECT_OTHER
        assert (not ('later.txt' | path exists))
        assert (not ('ignored' | path exists))
        if ($env.FAIL_CHECK? | is-not-empty) { exit 1 }
      }
      _ => { error make {msg: $"Unexpected Nix command: ($command)"} }
    }
  }
}
