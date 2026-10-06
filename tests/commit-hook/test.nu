use std/assert

def --wrapped git [...args: string]: nothing -> string {
  let result = ^git ...$args | complete
  if $result.exit_code != 0 {
    error make {msg: $"git ($args | str join ' ') failed: ($result.stdout)($result.stderr)"}
  }
  $result.stdout
}

def with-repo [hooks: string, action: closure] {
  let previous = $env.PWD
  let directory = mktemp -d
  try {
    cd $directory
    git init -q | ignore
    git config user.email test@example.invalid | ignore
    git config user.name Test | ignore
    "original\n" | save sample.nix
    "obsolete\n" | save obsolete.txt
    "other\n" | save other.txt
    "ignored\n" | save .gitignore
    git add . | ignore
    git commit -qm initial | ignore
    git config core.hooksPath $hooks | ignore
    "needs formatting\n" | save --force sample.nix
    git add sample.nix | ignore
    with-env {NIX_CALLS: ($directory | path join .git nix-calls), EXPECT_OTHER: "other\n"} $action
  } finally {
    cd $previous
    rm --recursive --force $directory
  }
}

def main [hooks: string] {
  # Fixes that would overwrite pending work are refused before any mutation.
  for pending in [sample.nix hook-new.txt] {
    with-repo $hooks {
      "keep this work\n" | save --force $pending
      let before_index = git write-tree
      let before_status = git status --porcelain
      let before_diff = git diff
      let result = ^git commit -m blocked | complete
      assert ($result.exit_code != 0)
      assert (($result.stdout + $result.stderr) | str contains $pending)
      assert equal (git write-tree) $before_index
      assert equal (git status --porcelain) $before_status
      assert equal (git diff) $before_diff
      assert equal (open --raw $pending) "keep this work\n"
      assert equal (open --raw $env.NIX_CALLS) "fmt\nbuild\n"
    }
  }

  # Unrelated pending work stays out of the snapshot and the commit.
  for fail_check in [false true] {
    with-repo $hooks {
      "not part of the commit\n" | save ignored
      "unstaged edit\n" | save --force other.txt
      "later commit\n" | save later.txt
      "already staged\n" | save user-change.txt
      git add user-change.txt | ignore
      let before_head = git rev-parse HEAD
      let result = with-env {FAIL_CHECK: (if $fail_check { "1" } else { "" })} {
        ^git commit -m automated | complete
      }
      let output = $result.stdout + $result.stderr
      assert equal ($result.exit_code != 0) $fail_check $output
      assert equal (open --raw $env.NIX_CALLS) "fmt\nbuild\nflake\n"
      assert ($output | str contains sample.nix)
      assert ($output | str contains hook-new.txt)
      assert (not ($output | lines | any {|line|
        ($line | str contains user-change.txt) and ($line | str contains '|')
      }))
      assert equal (git show :sample.nix) "formatted\n"
      assert equal (git show :docs/generated/modules.md) "generated catalogue\n"
      assert equal (git show :hook-new.txt) "created by hook\n"
      assert equal (git show :other.txt) "other\n"
      assert equal (git ls-files obsolete.txt ignored later.txt) ""
      assert equal (open --raw sample.nix) "formatted\n"
      assert equal (open --raw docs/generated/modules.md) "generated catalogue\n"
      assert equal (open --raw hook-new.txt) "created by hook\n"
      assert (not ('obsolete.txt' | path exists))
      assert equal (open --raw other.txt) "unstaged edit\n"
      assert equal (open --raw later.txt) "later commit\n"
      assert equal (git diff --name-only) "other.txt\n"
      if $fail_check {
        assert equal (git rev-parse HEAD) $before_head
        assert (git diff --cached --name-only | is-not-empty)
      } else {
        assert equal (git status --porcelain) " M other.txt\n?? later.txt\n"
        assert equal (git show HEAD:docs/generated/modules.md) "generated catalogue\n"
      }
    }
  }

  # `git commit -a` commits a temporary index, which the hook must use.
  with-repo $hooks {
    "all edits\n" | save --force other.txt
    let result = with-env {EXPECT_OTHER: "all edits\n"} {
      ^git commit -am all | complete
    }
    assert equal $result.exit_code 0 ($result.stdout + $result.stderr)
    assert equal (git show HEAD:sample.nix) "formatted\n"
    assert equal (git show HEAD:other.txt) "all edits\n"
    assert equal (git status --porcelain) ""
  }

  with-repo $hooks {
    let before_index = git write-tree
    let result = with-env {FAIL_FMT: "1"} {
      ^git commit -m 'format failure' | complete
    }
    assert ($result.exit_code != 0)
    assert equal (open --raw $env.NIX_CALLS) "fmt\n"
    assert equal (open --raw sample.nix) "needs formatting\n"
    assert equal (git write-tree) $before_index
    assert equal (git status --porcelain) "M  sample.nix\n"
  }
}
