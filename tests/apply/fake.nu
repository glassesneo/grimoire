def --wrapped main [command: string, ...args: string] {
  $"($command) ($args | str join ' ')\n" | save --append $env.CALLS
  match [$command ($args | first)] {
    [hostname _] => { print local }
    [nix build] => {
      if ($env.FAIL_ON? | is-not-empty) and ($args | any {|arg| $arg | str contains $env.FAIL_ON }) {
        if ($env.FAIL_WITH_PATH? | is-not-empty) { print /nix/store/fake-partial }
        exit 1
      }
      $args | where {|arg| $arg | str contains '#' } | each {|attr| $"/nix/store/fake-($attr | hash md5)" } | str join "\n" | print
    }
    [nix flake] => {
      if ($args | get 1) == metadata {
        let ref = $args | last
        let path = if ($ref | str starts-with "path:") { $ref | str substring 5.. } else { "/nix/store/fake-source" }
        print ({path: $path} | to json)
      }
    }
    [nix copy] => {}
    [nix-store --add-root] => {}
    [ssh _] => {
      if ($args | last) == whoami { print fixture }
    }
    _ => { error make {msg: $"Unexpected command: ($command) ($args)"} }
  }
}
