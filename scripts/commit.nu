# Owns the commit transaction: fix a snapshot of the index, stage the fixes,
# mirror them into the worktree, then check the snapshot. Unstaged and untracked
# work stays out of the snapshot, so a change can be split over several commits.
# Fixes are refused before any mutation when they would overwrite such work.
use ./docs.nu
use ./checks.nu [select-checks build-checks]
use ./snapshot.nu settle

const empty = "0000000000000000000000000000000000000000"

export def main [] {
  do --capture-errors {
    cd (^git rev-parse --show-toplevel | str trim)
    # `git commit <paths>` and `git commit -a` commit a temporary index.
    let index = $env.GIT_INDEX_FILE? | default (^git rev-parse --git-path index | str trim) | path expand
    let before = ^git write-tree | str trim
    let snapshot = mktemp --directory --tmpdir repository-hook.XXXXXX
    try {
      ^git checkout-index --all --prefix $"($snapshot)/"
      settle $snapshot
      do {
        cd $snapshot
        # The snapshot's root is new on every commit, so a treefmt cache would
        # never be reused and would only accumulate.
        ^nix fmt --no-update-lock-file -- --no-cache
      }
      settle $snapshot
      docs --root $snapshot
      settle $snapshot

      # Stage the snapshot into a copy of the index to learn the fixes.
      let scratch = $"($snapshot).index"
      cp $index $scratch
      let after = with-env {GIT_INDEX_FILE: $scratch} {
        ^git --work-tree $snapshot add --all
        ^git write-tree | str trim
      }
      let fixes = ^git diff-tree -r -z --no-renames $before $after
        | split row (char nul)
        | compact --empty
        | chunks 2
        | each {|pair|
          let fields = $pair.0 | str substring 1.. | split row ' '
          {mode: $fields.1, object: $fields.3, path: $pair.1}
        }

      let pending = (^git diff --name-only -z | split row (char nul)) ++ (^git ls-files --others --exclude-standard -z | split row (char nul))
      let blocked = $fixes.path | where {|path| $path in $pending }
      if ($blocked | is-not-empty) {
        error make {msg: $"Automatic fixes would overwrite unstaged or untracked work in:\n  ($blocked | str join "\n  ")\nRun `nix fmt` and `just docs`, stage what belongs to this commit, and commit again."}
      }

      if ($fixes | is-not-empty) {
        $fixes
          | each {|fix| $"($fix.mode) (if $fix.mode == '000000' { $empty } else { $fix.object })\t($fix.path)(char nul)" }
          | str join
          | ^git update-index -z --index-info
        let removed = $fixes | where mode == '000000' | get path
        let written = $fixes | where mode != '000000' | get path
        $removed | each {|path| rm --force $path } | ignore
        if ($written | is-not-empty) {
          $written | each {|path| $"($path)(char nul)" } | str join | ^git checkout-index --force -z --stdin
        }
      }
      ^git --no-pager diff --cached --stat $before --

      # Git supplies an implicit empty-tree comparison on an unborn branch.
      let changes = ^git diff --cached --name-status -z --no-renames
        | split row (char nul)
        | compact --empty
        | chunks 2
        | each {|pair| {status: $pair.0, path: $pair.1} }
      do {
        cd $snapshot
        let system = ^nix eval --impure --raw --expr builtins.currentSystem | str trim
        let metadata = ^nix eval --json --no-update-lock-file $"path:.#lib.checks.($system)" | from json
        let selected = select-checks $metadata $changes
        print $"Selected checks: ($selected | str join ', ')"
        build-checks 'path:.' $system $selected
      }
    } finally {
      rm --recursive --force $snapshot $"($snapshot).index"
    }
  }
}
