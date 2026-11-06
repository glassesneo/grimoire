# Gives hook snapshots a content-only identity for Nix. A `path:` flake's
# evaluation cache key includes its newest mtime, so snapshots of equal content
# share cached evaluations only when every mtime is the same fixed value.
# Settle after each change and before each Nix invocation that reads the tree.
export def settle [directory: path] {
  ^find $directory -exec touch --no-dereference --date=@1 '{}' +
}
