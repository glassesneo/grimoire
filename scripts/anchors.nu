# Update modules' anchors, the npins lock files `anchors.json` that
# `lib/anchors.nix` reads, through npins in lock-file mode.
#
# A module is named by its interface path; its directory comes from the
# flake's check metadata. `npins` comes from the development shell.

def files-of [module?: string]: nothing -> list<string> {
  if $module == null {
    return (glob abstractions/**/anchors.json | path relative-to $env.PWD | sort)
  }
  let system = ^nix eval --impure --raw --expr builtins.currentSystem
  # Only names and directories, so the dependency closure stays unevaluated.
  let roots = ^nix eval --json --no-update-lock-file $".#lib.checks.($system).moduleRoots" --apply "map (root: {inherit (root) name directory;})" | from json | where name == $module
  if ($roots | is-empty) {
    error make {msg: $"no module is named ($module)"}
  }
  let file = $"($roots.0.directory)/anchors.json"
  if not ($file | path exists) {
    error make {msg: $"module ($module) has no anchors.json"}
  }
  [$file]
}

# Update every pin of every module, or of MODULE only.
export def main [module?: string] {
  cd (^git rev-parse --show-toplevel | str trim)
  for file in (files-of $module) {
    print $"updating ($file)"
    ^npins --lock-file $file update
  }
}
