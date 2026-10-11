# Records each call in $env.CALLS. A build whose arguments contain
# $env.FAIL_ON fails, printing a path first when $env.FAIL_WITH_PATH is set.
def --wrapped main [command: string, ...args: string] {
  $"($command) ($args | str join ' ')\n" | save --append $env.CALLS
  match [$command ($args | first)] {
    [hostname _] => { print local }
    [nix build] => {
      if ($env.FAIL_ON? | is-not-empty) and ($args | any {|arg| $arg | str contains $env.FAIL_ON }) {
        if ($env.FAIL_WITH_PATH? | is-not-empty) { print /nix/store/fake-partial }
        exit 1
      }
      print /nix/store/fake-output
    }
    [nix flake] => {
      if ($args | get 1) == metadata { print '{"path": "/nix/store/fake-source"}' }
    }
    [nix copy] => {}
    [ssh _] => {
      if ($args | last) == whoami { print fixture }
    }
    _ => { error make {msg: $"Unexpected command: ($command) ($args)"} }
  }
}
