# Runs reconcile.nu across successive generations against a real dinit and the
# fake launchctl, writing the descriptions itself as Hjem would. Each scene
# shows one statement of reconcile.nu's contract. A service appends a line to
# its mark file whenever it starts.
use std/assert

use common.nu [eventually lines-of]

def marks-file [name: string]: nothing -> path {
  $env.TMPDIR | path join marks $name
}

def starts [name: string]: nothing -> int {
  lines-of (marks-file $name) | length
}

def counts [...names: string]: nothing -> record {
  $names | reduce --fold {} {|name, counted| $counted | insert $name (starts $name) }
}

def service [type: string, text: string, depends: list<string>, automatic: bool, rerun: bool]: nothing -> record {
  {
    text: ($"type = ($type)\n($text)" + ($depends | each {|dependency| $"depends-on = ($dependency)\n" } | str join))
    type: $type
    dependsOn: $depends
    automatic: $automatic
    restartOnSwitch: $rerun
  }
}

def process [name: string, --version: int = 0, --depends: list<string> = [], --automatic, --rerun]: nothing -> record {
  service process $'command = "/bin/sh" "-c" "echo x >> (marks-file $name); exec /bin/sleep (1000 + $version)"
restart = no
' $depends $automatic $rerun
}

def scripted [name: string, --version: int = 0, --automatic, --rerun]: nothing -> record {
  service scripted $'command = "/bin/sh" "-c" "echo (1000 + $version) >> (marks-file $name)"
' [] $automatic $rerun
}

# The group dinit starts, which a run starts rather than wakes.
def group [...members: string]: nothing -> record {
  service internal ($members | each {|member| $"waits-for = ($member)\n" } | str join) [] false false
}

# Writes the descriptions and a step output. SERVICES maps names to services,
# dependencies first.
def generation [name: string, agent: string, services: record]: nothing -> path {
  let descriptions = $env.HOME | path join .config dinit.d
  ls --short-names $descriptions | get name | where {|file| $file not-in ($services | columns) } | each {|file| rm ($descriptions | path join $file) }
  let closure = $env.TMPDIR | path join $name
  mkdir $closure
  let all = $services | transpose name service
  let entries = $all | each {|entry|
    $entry.service.text | save --force ($descriptions | path join $entry.name)
    let dependents = $all | where {|other| $entry.name in $other.service.dependsOn } | get name
    $entry.service | reject text dependsOn | insert name $entry.name | insert file ($entry.service.text | hash sha256) | insert dependents $dependents
  }
  {label: test.dinit, socket: $env.SOCKET, dinitctl: $env.DINITCTL, services: $entries} | to json | save ($closure | path join services.json)
  $agent | save ($closure | path join agent.plist)
  $closure
}

def apply [closure: path]: nothing -> record {
  ^nu --no-config-file $env.RECONCILE $closure $env.HOME --launchctl $env.LAUNCHCTL | complete
}

def applied [closure: path] {
  let result = apply $closure
  assert equal $result.exit_code 0 $result.stderr
}

def domain []: nothing -> string {
  $"gui/(^id -u | str trim)"
}

def dinit-pid []: nothing -> string {
  open --raw ($env.FAKE_LAUNCHD | path join test.dinit.pid) | str trim
}

# Loads the agent as login does, once launchd has removed a previous job.
def load-agent [] {
  let plist = $env.HOME | path join Library LaunchAgents test.dinit.plist
  eventually 'the agent loads' { (^$env.LAUNCHCTL bootstrap (domain) $plist | complete).exit_code == 0 }
}

def --wrapped ctl [...args: string]: nothing -> record {
  ^$env.DINITCTL --socket-path $env.SOCKET ...$args | complete
}

def listed [name: string]: nothing -> bool {
  (ctl list).stdout | parse --regex '\]\s+(?<service>\S+)' | get service | any {|service| $service == $name }
}

def is-started [name: string]: nothing -> bool {
  (ctl --quiet is-started $name).exit_code == 0
}

# Waits until NAMES have started and no service is starting or stopping.
def settled [...names: string] {
  eventually $"($names | str join ', ') started" {
    ($names | all {|name| is-started $name }) and not ((ctl list).stdout =~ '<<|>>')
  }
  # A started process may not have written its mark yet.
  sleep 100ms
}

def main [] {
  let home = $env.HOME
  mkdir ($env.TMPDIR | path join marks) $env.FAKE_LAUNCHD ($home | path join .config dinit.d) ($home | path join Library LaunchAgents)
  $"#!/bin/sh\nexec dinit --user --quiet --services-dir ($home)/.config/dinit.d --socket-path ($env.SOCKET) --log-file ($env.TMPDIR)/dinit.log login\n" | save $env.FAKE_AGENT
  chmod +x $env.FAKE_AGENT

  # A job of the former launchd backend, loaded and running.
  let legacy = $home | path join .local state hjem services
  mkdir $legacy
  [{name: old, label: old.job, domain: gui}] | to json | save ($legacy | path join state.json)
  'old' | save ($home | path join Library LaunchAgents old.job.plist)
  touch ($env.FAKE_LAUNCHD | path join old.job.loaded)
  ^sh -c 'nohup /bin/sleep 1000 >/dev/null 2>&1 & echo $!' | str trim | save ($env.FAKE_LAUNCHD | path join old.job.pid)

  # A run that starts dinit starts the automatic services, not the others, and
  # retires the former backend's jobs.
  mut services: record = {
    a: (process a --automatic)
    b: (process b --automatic)
    u: (process u --automatic)
    c: (scripted c --automatic --rerun)
    m: (process m)
    login: (group a b u c)
  }
  applied (generation g1 v1 $services)
  settled a b u c
  assert equal (counts a b u c m) {a: 1, b: 1, u: 1, c: 1, m: 0}
  assert (not ($home | path join Library LaunchAgents old.job.plist | path exists))
  assert (not ($env.FAKE_LAUNCHD | path join old.job.loaded | path exists))
  assert (not ($legacy | path exists))
  print 'PASS: a first run starts dinit with the automatic services and retires former jobs'

  # Changed services restart, removed ones are unloaded, added automatic ones
  # start and restartOnSwitch services rerun; the rest keep running.
  let instance = dinit-pid
  $services = ($services | reject b login | merge {a: (process a --version 1 --automatic), f: (process f --automatic)} | insert login (group a u c f))
  applied (generation g2 v1 $services)
  settled a u c f
  assert equal (counts a b u c f m) {a: 2, b: 1, u: 1, c: 2, f: 1, m: 0}
  assert (not (listed b))
  assert equal (dinit-pid) $instance
  print 'PASS: a run applies added, changed, removed and restartOnSwitch services'

  # A service dinit cannot reload while started, here because its type
  # changed, is applied.
  $services = ($services | merge {a: (scripted a --automatic)})
  applied (generation g3 v1 $services)
  settled a c
  assert equal (counts a c) {a: 3, c: 3}
  print 'PASS: a service that cannot be reloaded while started is applied'

  # A manual service that was started restarts when it changes.
  ctl start m | ignore
  settled m
  $services = ($services | merge {m: (process m --version 1)})
  applied (generation g4 v1 $services)
  settled m c
  assert equal (counts m c) {m: 2, c: 4}
  print 'PASS: a started manual service restarts when it changes'

  # A stopped service starts when it becomes automatic, although only its
  # group's description changes.
  $services = ($services | reject login | insert n (process n) | insert login (group a u c f))
  applied (generation g5 v1 $services)
  settled c
  assert equal (starts n) 0
  $services = ($services | reject login | merge {n: (process n --automatic)} | insert login (group a u c f n))
  applied (generation g6 v1 $services)
  settled n
  assert equal (starts n) 1
  print 'PASS: a service that becomes automatic starts'

  # A dependency and its dependent added together both start; restarting the
  # dependency restarts its dependent once.
  $services = ($services | reject login | insert dep (process dep --automatic) | insert user (process user --depends [dep] --automatic --rerun) | insert login (group a u c f n user))
  applied (generation g7 v1 $services)
  settled dep user
  assert equal (counts dep user) {dep: 1, user: 1}
  $services = ($services | merge {dep: (process dep --version 1 --automatic)})
  applied (generation g8 v1 $services)
  settled dep user
  assert equal (counts dep user) {dep: 2, user: 2}
  print 'PASS: dependencies start and restart with their dependents'

  # An instance that launchd started, as at login, runs the descriptions it
  # found; the next run brings it to the declarations.
  ^$env.LAUNCHCTL bootout $"(domain)/test.dinit"
  load-agent
  settled a u c f n user
  let relaunched = counts u
  $services = ($services | reject f login | merge {u: (process u --version 1 --automatic)} | insert login (group a u c n user))
  applied (generation g9 v1 $services)
  settled u
  assert equal (starts u) ($relaunched.u + 1)
  assert (not (listed f))
  print 'PASS: a run applies the declarations to an instance launchd started'

  # A loaded agent whose dinit has exited is started again.
  ctl shutdown | ignore
  eventually 'dinit exits' { (^kill -0 (dinit-pid) | complete).exit_code != 0 }
  applied (generation g10 v1 $services)
  settled a u c n user
  print 'PASS: a loaded agent whose dinit exited is started'

  # A changed agent restarts dinit, which starts the automatic services once.
  let before = counts c u
  let instance = dinit-pid
  applied (generation g11 v2 $services)
  settled c u
  assert not equal (dinit-pid) $instance
  assert equal (counts c u) {c: ($before.c + 1), u: ($before.u + 1)}
  print 'PASS: a changed agent restarts dinit'

  # Without a GUI session a run only writes the agent's plist; login loads
  # it, and the next run keeps that instance.
  ^$env.LAUNCHCTL bootout $"(domain)/test.dinit"
  touch ($env.FAKE_LAUNCHD | path join no-gui)
  let result = apply (generation g12 v3 $services)
  assert equal $result.exit_code 0 $result.stderr
  assert str contains $result.stdout 'no GUI session'
  assert equal (open --raw ($home | path join Library LaunchAgents test.dinit.plist)) v3
  rm ($env.FAKE_LAUNCHD | path join no-gui)
  load-agent
  settled a u c n user
  let instance = dinit-pid
  let before = counts u
  applied (generation g13 v3 $services)
  settled c
  assert equal (dinit-pid) $instance
  assert equal (counts u) $before
  print 'PASS: without a GUI session login loads the written agent'

  # A run without its state restarts the loaded agent once.
  rm ($home | path join .local state hjem dinit state.json)
  let instance = dinit-pid
  applied (generation g13b v3 $services)
  settled a u c n user
  assert not equal (dinit-pid) $instance
  print 'PASS: a run without its state restarts the agent'

  # A failed service does not stop the others, and the next run applies it.
  $services = ($services | merge {g: (process g), u: (process u --version 2 --automatic)})
  let closure = generation g14 v3 $services
  let description = $home | path join .config dinit.d g
  chmod 000 $description
  let before = counts u
  let result = apply $closure
  assert not equal $result.exit_code 0
  assert str contains $result.stderr 'failed to apply g'
  settled u
  assert equal (starts u) ($before.u + 1)
  chmod 644 $description
  applied (generation g15 v3 $services)
  assert (listed g)
  assert equal (starts u) ($before.u + 1)
  print 'PASS: a failed service is applied by the next run'

  # Without services, the agent is retired with its state.
  let instance = dinit-pid
  applied (generation g16 v3 {})
  assert (not ($home | path join Library LaunchAgents test.dinit.plist | path exists))
  assert (not ($env.FAKE_LAUNCHD | path join test.dinit.loaded | path exists))
  assert (not ($home | path join .local state hjem dinit state.json | path exists))
  eventually 'dinit exits' { (^kill -0 $instance | complete).exit_code != 0 }
  print 'PASS: a run without services retires dinit'
}
