# Contract of forwarded_agent.nu, run against a fake ssh-add (fake-ssh-add.nu)
# that answers for each socket as FAKE_AGENTS says: the keys it lists, "dead"
# or "hang". Candidates are real sockets that socat listens on.
use std/assert

const signing = 'sk-ecdsa-sha2-nistp256@openssh.com AAAAsigning'
const push = 'sk-ecdsa-sha2-nistp256@openssh.com AAAApush'
const other = 'ssh-ed25519 AAAAother'

def socket [home: path, name: string, age: int]: nothing -> string {
  let path = $home | path join .ssh $name
  ^sh -c 'socat UNIX-LISTEN:"$0",fork /dev/null >/dev/null 2>&1 & echo $! >> "$1"' $path ($home | path join pids)
  for _ in 0..<100 {
    if ($path | path exists) { break }
    sleep 50ms
  }
  ^touch -h -d $"@((date now | into int) // 1_000_000_000 - $age)" $path
  $path
}

def setup [agents: record]: nothing -> record {
  let home = mktemp --directory
  mkdir ($home | path join .ssh agent)
  let sockets = $agents | items {|name, spec| {name: $name, path: (socket $home $name $spec.age), behavior: $spec.behavior} }
  {home: $home, agents: ($sockets | reduce --fold {} {|it, acc| $acc | merge {($it.path): $it.behavior} })}
}

def teardown [world: record] {
  open ($world.home | path join pids) | lines | each {|pid| ^kill $pid } | ignore
}

# Passes the arguments as the wrapper in default.nix does, through the
# environment.
def --wrapped invoke [script: path, world: record, mode: string, ...args: string] {
  let arguments = $args | enumerate | reduce --fold {WFA_ARGC: ($args | length | into string)} {|it, acc| $acc | insert $"WFA_ARG_($it.index)" $it.item }
  with-env ($arguments | merge {
    HOME: $world.home
    WFA_SIGNING_KEY: $signing
    WFA_PUSH_KEY: $push
    WFA_SSH_ADD: $env.FAKE_SSH_ADD
    WFA_SSH_KEYGEN: echo
    WFA_SSH: echo
    WFA_TIMEOUT: timeout
    WFA_REX_SOCKET: ($world.home | path join .ssh rex-agent.sock)
    FAKE_AGENTS: ($world.agents | to json --raw)
  }) {
    ^nu --no-config-file $script $mode | complete
  }
}

def --wrapped chosen [script: path, world: record, ...args: string] {
  invoke $script $world exec ...$args sh -c 'printf %s "$SSH_AUTH_SOCK"'
}

def main [script: path] {
  # A dead and a hanging agent are skipped within the overall deadline.
  let world = setup {'agent/s.live': {age: 30, behavior: [$signing]}, 'agent/s.dead': {age: 10, behavior: dead}, 'agent/s.hang': {age: 0, behavior: hang}}
  let start = date now
  let result = chosen $script $world
  assert equal [$result.exit_code $result.stdout] [0 ($world.home | path join .ssh agent s.live)] 'the live agent is chosen'
  assert ((date now) - $start < 6sec) 'a hanging agent does not stall the choice'
  teardown $world

  # An agent holding a key outside the remote agent's is never used.
  let world = setup {'agent/s.human': {age: 0, behavior: [$signing $push $other]}, 'rex-agent.sock': {age: 60, behavior: [$signing]}}
  assert equal (chosen $script $world).stdout ($world.home | path join .ssh rex-agent.sock) 'the agent with a foreign key is skipped'
  teardown $world

  # Without the signing key no agent qualifies.
  let world = setup {'agent/s.empty': {age: 0, behavior: []}, 'agent/s.pushonly': {age: 0, behavior: [$push]}}
  let result = chosen $script $world
  assert ($result.exit_code != 0) 'no agent qualifies without the signing key'
  assert str contains $result.stderr 'no live remote agent'
  teardown $world

  # A push needs the unlocked GitHub key.
  let world = setup {'rex-agent.sock': {age: 0, behavior: [$signing]}}
  let result = chosen $script $world --require-push
  assert ($result.exit_code != 0) 'a push fails while the GitHub key is locked'
  assert str contains $result.stderr 'locked'
  let unlocked = $world | update agents {|w| $w.agents | merge {($w.home | path join .ssh rex-agent.sock): [$signing $push]} }
  assert equal (chosen $script $unlocked --require-push).exit_code 0 'a push proceeds once the GitHub key is unlocked'
  teardown $world

  # The inherited socket comes first when it qualifies.
  let world = setup {'agent/s.older': {age: 100, behavior: [$signing]}, 'agent/s.newer': {age: 0, behavior: [$signing]}}
  let older = $world.home | path join .ssh agent s.older
  assert equal (with-env {SSH_AUTH_SOCK: $older} { chosen $script $world }).stdout $older 'the inherited socket is preferred'
  teardown $world

  # ssh-keygen picks an agent only to sign; ssh only for GitHub.
  let world = setup {}
  let verify = invoke $script $world ssh-keygen -Y verify -n git
  assert equal [$verify.exit_code ($verify.stdout | str trim)] [0 '-Y verify -n git'] 'verification passes through'
  assert ((invoke $script $world ssh-keygen -Y sign -n git).exit_code != 0) 'signing needs an agent'
  assert equal (invoke $script $world ssh -G git@github.com).exit_code 0 'ssh -G passes through'
  assert equal (invoke $script $world ssh git@example.org git-upload-pack).exit_code 0 'other hosts pass through'
  let literal = invoke $script $world ssh git@example.org 'true' '' 'null' '-x' ')'
  assert equal [$literal.exit_code ($literal.stdout | str trim --right --char "\n")] [0 'git@example.org true  null -x )'] 'arguments that read as Nushell literals pass through as strings'
  assert equal (invoke $script $world ssh git@github.com "git-receive-pack 'x.git'").exit_code 255 'a GitHub push needs an agent'
  print 'forwarded_agent.nu: all cases passed'
}
