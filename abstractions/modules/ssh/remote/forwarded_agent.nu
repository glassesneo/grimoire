const candidate_timeout = 1sec
const total_timeout = 3sec

def key-id [line: string] {
  let parts = $line | split row --regex '\s+' | where {|part| $part != '' }
  if ($parts | length) >= 2 { $"($parts.0) ($parts.1)" }
}

def candidates []: nothing -> list<string> {
  let me = ^id -un | str trim
  let paths = [$env.WFA_REX_SOCKET] ++ (glob ($env.HOME | path join .ssh agent '*'))
  let found = $paths
    | where {|path| $path | path exists }
    | each {|path| ls --long --directory $path | first }
    | where type == socket and user == $me
    | sort-by modified --reverse
    | get name
  let inherited = $env.SSH_AUTH_SOCK? | default ''
  if $inherited in $found {
    [$inherited] ++ ($found | where {|path| $path != $inherited })
  } else {
    $found
  }
}

def agent-keys [path: string, timeout: duration] {
  let seconds = $timeout / 1sec | into string
  let result = with-env {SSH_AUTH_SOCK: $path} {
    ^$env.WFA_TIMEOUT $seconds $env.WFA_SSH_ADD -L | complete
  }
  if $result.exit_code == 0 {
    $result.stdout | lines | each {|line| key-id $line } | compact
  }
}

def select [require_push: bool] {
  let signing = key-id $env.WFA_SIGNING_KEY
  let push = key-id $env.WFA_PUSH_KEY
  let deadline = (date now) + $total_timeout
  mut locked = false
  for path in (candidates) {
    let remaining = $deadline - (date now)
    if $remaining <= 0sec { break }
    let keys = agent-keys $path ([$candidate_timeout $remaining] | math min)
    if $keys == null or $signing not-in $keys or ($keys | any {|key| $key not-in [$signing $push] }) {
      continue
    }
    if $require_push and $push not-in $keys {
      $locked = true
      continue
    }
    return $path
  }
  if $locked {
    error make --unspanned {msg: 'the GitHub key is locked; run push-unlock on the key holder'}
  }
  error make --unspanned {msg: 'no live remote agent from the key holder answers here'}
}

def targets-github [args: list<string>]: nothing -> bool {
  $args | any {|arg| $arg == 'github.com' or ($arg | str ends-with '@github.com') }
}

def main [mode: string] {
  let count = $env.WFA_ARGC? | default '0' | into int
  mut args = 0..<$count | each {|index| $env | get $"WFA_ARG_($index)" }
  for index in 0..<$count { hide-env $"WFA_ARG_($index)" }
  let failure = if $mode == ssh { 255 } else { 1 }
  let chosen = try {
    match $mode {
      exec => {
        let require_push = ($args | get --optional 0) == '--require-push'
        if $require_push { $args = $args | skip 1 }
        if ($args | get --optional 0) == '--' { $args = $args | skip 1 }
        if ($args | is-empty) {
          print --stderr 'usage: with-forwarded-agent [--require-push] [--] PROGRAM [ARG...]'
          exit 2
        }
        {program: ($args | first), args: ($args | skip 1), socket: (select $require_push)}
      }
      ssh-keygen => {
        let signs = $args | window 2 | any {|pair| $pair == ['-Y' sign] }
        {program: $env.WFA_SSH_KEYGEN, args: $args, socket: (if $signs { select false })}
      }
      ssh => {
        let picks = '-G' not-in $args and (targets-github $args)
        {program: $env.WFA_SSH, args: $args, socket: (if $picks { select true })}
      }
      _ => {
        print --stderr $"unknown mode ($mode)"
        exit 2
      }
    }
  } catch {|error|
    print --stderr $"with-forwarded-agent: ($error.msg)"
    exit $failure
  }
  if $chosen.socket != null { $env.SSH_AUTH_SOCK = $chosen.socket }
  exec $chosen.program ...$chosen.args
}
