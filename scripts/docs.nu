export def main [--root: path] {
  do --capture-errors {
    let flake = if $root == null {
      cd (^git rev-parse --show-toplevel | str trim)
      "."
    } else {
      cd $root
      "path:."
    }
    let output = ^nix build $"($flake)#authoring-docs" --no-link --print-out-paths --no-update-lock-file | str trim
    mkdir docs/generated
    open --raw $output | save --force docs/generated/authoring.md
  }
}
