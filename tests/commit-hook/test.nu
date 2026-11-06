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
    with-env {NIX_CALLS: ($directory | path join .git nix-calls), SNAPSHOTS: ($directory | path join .git snapshots), PUSH_CONTENTS: ($directory | path join .git push-contents), CHECK_BUILDS: ($directory | path join .git check-builds), EXPECT_OTHER: "other\n"} {
      do $action
      if ($env.SNAPSHOTS | path exists) {
        for snapshot in (open --raw $env.SNAPSHOTS | lines | uniq) {
          assert (not ($snapshot | path exists))
          assert (not ($"($snapshot).index" | path exists))
          assert (not ($"($snapshot).tar" | path exists))
        }
      }
    }
  } finally {
    cd $previous
    rm --recursive --force $directory
  }
}

# Real Git objects/ref protocol and fake Nix observe sent tips, deduplication,
# exit status and unchanged local state without ever contacting a remote.
def test-push [hooks: string] {
  for mode in [success check-failure archive-failure] {
    let fail = $mode != 'success'
    with-repo $hooks {
      git reset --hard HEAD | ignore
      "one\n" | save push-marker
      git add push-marker | ignore
      git -c core.hooksPath=/dev/null commit -qm one | ignore
      let one = git rev-parse HEAD | str trim
      git tag -a sent-tag -m tag $one | ignore
      let tag = git rev-parse sent-tag | str trim
      git -c core.hooksPath=/dev/null commit --allow-empty -qm same-tree | ignore
      let same = git rev-parse HEAD | str trim
      "two\n" | save --force push-marker
      git add push-marker | ignore
      git -c core.hooksPath=/dev/null commit -qm two | ignore
      let two = git rev-parse HEAD | str trim
      # A blob tag is not a configuration, and the checkout isn't either tip.
      let blob = git rev-parse HEAD:push-marker | str trim
      git checkout -q $one | ignore
      "dirty\n" | save --force sample.nix
      "untracked\n" | save dirty-only
      "staged\n" | save --force other.txt
      git add other.txt | ignore
      let index = git write-tree
      let status = git status --porcelain
      let diff = git diff
      let zero = '0000000000000000000000000000000000000000'
      let updates = [
        $"refs/heads/other ($two) refs/heads/other ($zero)"
        $"refs/tags/sent-tag ($tag) refs/tags/sent-tag ($zero)"
        $"refs/heads/same ($same) refs/heads/same ($zero)"
        $"refs/heads/deleted ($zero) refs/heads/deleted ($one)"
        $"refs/tags/blob ($blob) refs/tags/blob ($zero)"
      ] | str join "\n"
      let result = with-env {FAIL_CHECK: (if $mode == 'check-failure' { '1' } else { '' }), FAIL_ARCHIVE: (if $mode == 'archive-failure' { '1' } else { '' })} {
        $updates | ^($hooks | path join pre-push) origin unused | complete
      }
      assert equal ($result.exit_code != 0) $fail ($result.stdout + $result.stderr)
      if $mode == 'archive-failure' {
        assert (not ($env.NIX_CALLS | path exists))
        assert (not ($env.PUSH_CONTENTS | path exists))
      } else {
        assert equal (open --raw $env.NIX_CALLS) (if $fail { "flake\n" } else { "flake\nflake\n" })
        assert equal (open --raw $env.PUSH_CONTENTS) (if $fail { "two\n" } else { "two\none\n" })
      }
      assert equal (git write-tree) $index
      assert equal (git status --porcelain) $status
      assert equal (git diff) $diff
      assert equal (git rev-parse HEAD | str trim) $one
      rm --force $env.NIX_CALLS
      $"refs/heads/deleted ($zero) refs/heads/deleted ($one)\nrefs/tags/blob ($blob) refs/tags/blob ($zero)\n" | ^($hooks | path join pre-push) origin unused
      assert (not ($env.NIX_CALLS | path exists))
      # Missing sent objects are errors, not legitimate non-commit tags.
      let missing = 'ffffffffffffffffffffffffffffffffffffffff'
      let invalid = $"refs/heads/missing ($missing) refs/heads/missing ($zero)\n" | ^($hooks | path join pre-push) origin unused | complete
      assert ($invalid.exit_code != 0)
      assert (not ($env.NIX_CALLS | path exists))
    }
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
      let result = with-env {FAIL_CHECK: (if $fail_check { "1" } else { "" }), SELECTIVE: '1'} {
        ^git commit -m automated | complete
      }
      let output = $result.stdout + $result.stderr
      assert equal ($result.exit_code != 0) $fail_check $output
      assert equal (open --raw $env.NIX_CALLS) "fmt\nbuild\neval\neval\nbuild\n"
      assert ($output | str contains sample.nix)
      assert ($output | str contains hook-new.txt)
      assert (not ($output | lines | any {|line|
        ($line | str contains user-change.txt) and ($line | str contains '|')
      }))
      assert equal (git show :sample.nix) "formatted\n"
      assert equal (git show :docs/generated/authoring.md) "generated reference\n"
      assert equal (git show :hook-new.txt) "created by hook\n"
      assert equal (git show :other.txt) "other\n"
      assert equal (git ls-files obsolete.txt ignored later.txt) ""
      assert equal (open --raw sample.nix) "formatted\n"
      assert equal (open --raw docs/generated/authoring.md) "generated reference\n"
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
        assert equal (git show HEAD:docs/generated/authoring.md) "generated reference\n"
      }
    }
  }

  # Within-file partial staging keeps the unstaged remainder out of validation.
  with-repo $hooks {
    "staged portion\n" | save --force other.txt
    git add other.txt | ignore
    "staged portion\nunstaged remainder\n" | save --force other.txt
    let result = with-env {EXPECT_OTHER: "staged portion\n"} { ^git commit -m partial | complete }
    assert equal $result.exit_code 0 ($result.stdout + $result.stderr)
    assert equal (git show HEAD:other.txt) "staged portion\n"
    assert equal (open --raw other.txt) "staged portion\nunstaged remainder\n"
    assert equal (git diff --name-only) "other.txt\n"
  }

  # Temporary-index failure retains worktree fixes, but Git may discard the
  # hook's staged updates. Do not invent synchronization with the real index.
  for args in [[-am failure] [-m failure sample.nix]] {
    with-repo $hooks {
      let before_head = git rev-parse HEAD
      let before_index = git write-tree
      let result = with-env {FAIL_CHECK: '1'} { ^git commit ...$args | complete }
      assert ($result.exit_code != 0)
      assert equal (git rev-parse HEAD) $before_head
      assert equal (git write-tree) $before_index
      assert equal (git show :sample.nix) "needs formatting\n"
      assert equal (open --raw sample.nix) "formatted\n"
      assert equal (open --raw hook-new.txt) "created by hook\n"
    }
  }

  # Empty selection never invokes a checks build (reference generation still builds).
  with-repo $hooks {
    let result = with-env {ZERO_CHECKS: '1'} { ^git commit -m zero | complete }
    assert equal $result.exit_code 0 ($result.stdout + $result.stderr)
    assert equal (open --raw $env.NIX_CALLS) "fmt\nbuild\neval\neval\n"
  }

  # Selected checks build as separate processes; a failure in any one of them,
  # not only the last, rejects the commit and names the failed check.
  for fail_only in ['' second] {
    with-repo $hooks {
      let before_head = git rev-parse HEAD
      let result = with-env {MANY_CHECKS: '1', FAIL_ONLY: $fail_only} { ^git commit -m many | complete }
      let output = $result.stdout + $result.stderr
      assert equal (ls --short-names $env.CHECK_BUILDS | get name | sort) [second selected.case third]
      if $fail_only == '' {
        assert equal $result.exit_code 0 $output
      } else {
        assert ($result.exit_code != 0)
        assert equal (git rev-parse HEAD) $before_head
        assert ($output | str contains 'Failed checks: second')
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

  # The initial commit has no HEAD; all staged paths still participate.
  with-repo $hooks {
    git update-ref -d HEAD | ignore
    let result = ^git commit -m initial-with-hook | complete
    assert equal $result.exit_code 0 ($result.stdout + $result.stderr)
    assert equal (git show HEAD:sample.nix) "formatted\n"
  }

  # NUL-delimited path handling preserves tabs/newlines through index fixes.
  with-repo $hooks {
    let odd = "odd\tname\n.nix"
    "tracked\n" | save $odd
    git add $odd | ignore
    let result = ^git commit -m odd | complete
    assert equal $result.exit_code 0 ($result.stdout + $result.stderr)
    assert equal (git show $"HEAD:($odd)") "tracked\n"
  }

  test-push $hooks

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
