# The full gate: builds every current-system check of FLAKE, formatting and
# reference freshness included, after reading their names with lock-file
# updates disabled. Besides the checks, `nix flake check` evaluates this
# flake's packages, development shells and formatter, which the `outputs`
# check evaluates too; the gate leaves out only that command's generic checks
# of output types and names.
use ./checks.nu build-checks

export def main [flake: string = '.'] {
  do --capture-errors {
    let system = ^nix eval --impure --raw --expr builtins.currentSystem | str trim
    let names = ^nix eval --json --no-update-lock-file $"($flake)#lib.checks.($system).checkNames" | from json
    print $"Checking ($names | length) checks."
    build-checks $flake $system $names
  }
}
