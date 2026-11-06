# Validate sent commit trees, not the checkout. Non-commit tags and deletions
# have no configuration to validate; distinct commits sharing a tree run once.
use ./run.nu checked
use ./gate.nu

def main [] {
  let updates = $in | lines | where {|line| $line | str trim | is-not-empty }
  do --capture-errors {
    cd (checked git rev-parse --show-toplevel | str trim)
    let trees = $updates | each {|line|
      let fields = $line | split row ' '
      let oid = $fields.1
      if ($oid | str replace --all '0' '' | is-empty) { return null }
      let object = checked git rev-parse --verify $"($oid)^{}" | str trim
      let kind = checked git cat-file -t $object | str trim
      if $kind != 'commit' {
        if ($fields.0 | str starts-with 'refs/tags/') { return null }
        error make {msg: $"Sent ref ($fields.0) does not point to a commit"}
      }
      checked git rev-parse $"($object)^{tree}" | str trim
    } | compact | uniq
    for tree in $trees {
      let snapshot = mktemp --directory --tmpdir repository-push.XXXXXX
      let failure = try {
        # Separate commands ensure archive failure cannot be hidden by tar.
        checked git archive --format=tar --output $"($snapshot).tar" $tree | ignore
        checked tar -xf $"($snapshot).tar" -C $snapshot | ignore
        do {
          cd $snapshot
          gate 'path:.'
        }
        null
      } catch {|error| $error } finally {
        rm --recursive --force $snapshot $"($snapshot).tar"
      }
      if $failure != null { error make $failure }
    }
  }
}
