# Runs a program with SSH_AUTH_SOCK naming a live remote agent.
#
# The key holder forwards one agent, its remote agent, to this host by two
# routes: Rex's tunnel binds it at WFA_REX_SOCKET, and every ordinary SSH
# session gets a socket of its own under ~/.ssh/agent. Sessions end and leave
# sockets behind, so no single path stays valid; each signing or push picks,
# at the moment it runs, a candidate that answers within its deadline and
# holds the signing key and nothing but the remote agent's keys. An agent
# holding any other key, such as the key holder's own agent forwarded by
# mistake, is never used. Pushing to GitHub further requires the GitHub key,
# which the remote agent holds only while the key holder has unlocked it.
#
# Modes:
#   exec [--require-push] [--] PROGRAM [ARG...]
#   ssh-keygen ARG...   ssh-keygen for Git's gpg.ssh.program; only -Y sign picks
#   ssh ARG...          ssh for Git's core.sshCommand; only GitHub picks
#
# The environment configures it: WFA_SIGNING_KEY and WFA_PUSH_KEY (OpenSSH
# public keys), WFA_SSH_ADD, WFA_SSH_KEYGEN, WFA_SSH and WFA_TIMEOUT (GNU
# timeout) as programs, and WFA_REX_SOCKET.

const candidate_timeout = 1sec
const total_timeout = 3sec

# "<type> <blob>" of an OpenSSH public key line, without its comment.
def key-id [line: string] {
  let parts = $line | split row --regex '\s+' | where {|part| $part != '' }
  if ($parts | length) >= 2 { $"($parts.0) ($parts.1)" }
}

# Sockets of this user that may lead to the remote agent, the inherited one
# first, then the most recently created.
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

# The keys the agent at PATH lists, or null when it does not answer in time.
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

def --wrapped main [...argv: string] {
  let mode = $argv | first
  mut args = $argv | skip 1
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
