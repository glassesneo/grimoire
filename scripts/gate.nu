# The full gate: builds every current-system check of FLAKE, formatting and
# reference freshness included. The checks also cover what `nix flake check`
# validates in this flake, so the gate replaces it; see checks/default.nix.
use ./checks.nu build-checks

export def main [flake: string = '.'] {
  do --capture-errors {
    let system = ^nix eval --impure --raw --expr builtins.currentSystem | str trim
    let names = ^nix eval --json --no-update-lock-file $"($flake)#lib.checks.($system).checkNames" | from json
    print $"Checking ($names | length) checks."
    build-checks $flake $system $names
  }
}
