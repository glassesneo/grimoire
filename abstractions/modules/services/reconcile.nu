# Owns the switch-time lifecycle of the dinit user instance and its services.
#
# Arguments: the step's output, holding services.json and agent.plist, and the
# home. Hjem has already placed the descriptions in the services directory.
# services.json lists dependencies before their dependents, each with the
# services that a forced restart of it also restarts, and ends with login.
# HOME/.local/state/hjem/dinit/state.json records the agent plist the last run
# left for launchd and, per service, the description and automatic start it
# last applied. Losing it makes the next run restart a loaded agent once. The
# step's lock serializes runs.
#
# A run:
# 1. retires the LaunchAgents that the former launchd backend's journal,
#    .local/state/hjem/services/state.json, names, then that state;
# 2. without services, boots the agent out when it is loaded, removes its plist
#    and the state, and stops;
# 3. creates Library/Logs, where dinit logs, and writes the agent's plist to
#    Library/LaunchAgents when it differs. Without a GUI session it records
#    the plist and stops; login loads the agent. Otherwise it boots the agent
#    out when it is loaded from a plist other than the recorded one,
#    bootstraps it when it is not loaded, starts it when it is loaded but not
#    running, and waits for the control socket;
# 4. when it started dinit, dinit has started the automatic services from the
#    current descriptions, so the run records them without acting on them;
# 5. otherwise brings the running instance, however it was started, to the
#    declarations: it reloads added and changed descriptions, stopping a
#    service and its dependents first when dinit refuses to reload it while
#    started; stops and unloads removed services, dependents first; restarts
#    each started service other than an internal one that changed or declares
#    restartOnSwitch, together with its dependents, once; and requests a start
#    of stopped services that were started before the run, or that are
#    automatic and were added, changed, became automatic or declare
#    restartOnSwitch. A start that nothing started waits for is not requested.
#
# Start and restart requests do not wait, so success does not mean readiness.
# A failed operation does not stop the others; the failed service is applied
# again by the next run, a service whose new description cannot be loaded is
# started with its previous one when it was started, and the run fails at the
# end.

# Runs an external command and returns its completion record.
def --wrapped execute [command: string, ...args: string]: nothing -> record {
  run-external $command ...$args | complete
}

def --wrapped checked [command: string, ...args: string]: nothing -> string {
  let result = execute $command ...$args
  if $result.exit_code != 0 {
    error make {msg: $"($command) ($args | str join ' ') failed: ($result.stderr)"}
  }
  $result.stdout
}

def --wrapped ctl [manifest: record, ...args: string]: nothing -> record {
  execute $manifest.dinitctl --socket-path $manifest.socket ...$args
}

def --wrapped ctl-ok [manifest: record, ...args: string]: nothing -> bool {
  (ctl $manifest ...$args).exit_code == 0
}

# Runs CONDITION up to ATTEMPTS times, 100ms apart, until it holds.
def retry [attempts: int, condition: closure]: nothing -> bool {
  for _ in 0..<$attempts {
    if (do $condition) { return true }
    sleep 100ms
  }
  false
}

# Writes CONTENT to FILE through a temporary file in the same directory.
def save-atomic [file: path, content: string] {
  let temporary = $"($file).tmp"
  $content | save --force $temporary
  mv --force $temporary $file
}

def started [manifest: record, name: string]: nothing -> bool {
  ctl-ok $manifest --quiet is-started $name
}

def retire-launchd [home: path, uid: string, launchctl: string] {
  let state = $home | path join .local state hjem services
  let journal = $state | path join state.json
  if not ($journal | path exists) { return }
  for entry in (open $journal) {
    let job = $"($entry.domain)/($uid)/($entry.label)"
    if (execute $launchctl print $job).exit_code == 0 {
      checked $launchctl bootout $job | ignore
    }
    rm --force ($home | path join Library LaunchAgents $"($entry.label).plist")
  }
  rm --recursive --force $state
}

def retire-agent [manifest: record, home: path, uid: string, launchctl: string] {
  let job = $"gui/($uid)/($manifest.label)"
  if (execute $launchctl print $job).exit_code == 0 {
    checked $launchctl bootout $job | ignore
  }
  rm --force ($home | path join Library LaunchAgents $"($manifest.label).plist")
}

# Writes the agent's plist and returns whether dinit was started by this run,
# or null without a GUI session. APPLIED is the plist the last run left.
def start-agent [manifest: record, content: string, applied: any, home: path, uid: string, launchctl: string]: nothing -> any {
  let agents = $home | path join Library LaunchAgents
  mkdir $agents ($home | path join Library Logs)
  let target = $agents | path join $"($manifest.label).plist"
  if not ($target | path exists) or (open --raw $target) != $content {
    save-atomic $target $content
  }
  let domain = $"gui/($uid)"
  if (execute $launchctl print $domain).exit_code != 0 { return null }
  let job = $"($domain)/($manifest.label)"
  let status = execute $launchctl print $job
  let running = $status.stdout | parse --regex '(?m)^\s*pid = (?<pid>\d+)\s*$' | is-not-empty
  mut loaded = $status.exit_code == 0
  if $loaded and $applied != $content {
    checked $launchctl bootout $job | ignore
    $loaded = false
  }
  if not $loaded {
    # launchd may still be removing a job it has just booted out; the last
    # attempt reports the error.
    if not (retry 50 { (execute $launchctl bootstrap $domain $target).exit_code == 0 }) {
      checked $launchctl bootstrap $domain $target | ignore
    }
  } else if not $running {
    checked $launchctl kickstart $job | ignore
  }
  if not (retry 100 { ctl-ok $manifest list }) {
    error make {msg: $"dinit did not open ($manifest.socket)"}
  }
  not ($loaded and $running)
}

# Unloads NAMES, dependents first, and returns those still loaded.
def unload [manifest: record, names: list<string>]: nothing -> list<string> {
  mut pending = $names
  loop {
    mut rest = []
    for name in $pending {
      if not (ctl-ok $manifest unload $name) { $rest = ($rest | append $name) }
    }
    let progress = ($rest | length) < ($pending | length)
    $pending = $rest
    if not $progress { break }
  }
  # A service that was never loaded and has no description cannot be found.
  $pending | where {|name| ctl-ok $manifest status $name }
}

# Requests a start of SERVICE, returning false when dinit refused it. An
# automatic service is woken, so that it runs for its dependents; nothing is
# requested when none of them is active.
def request-start [manifest: record, service: record]: nothing -> bool {
  if $service.automatic {
    let result = ctl $manifest wake --no-wait $service.name
    $result.exit_code == 0 or ($"($result.stdout)($result.stderr)" | str contains "no active dependents")
  } else {
    ctl-ok $manifest start --no-wait $service.name
  }
}

def main [closure: path, home: path, --launchctl: string = "/bin/launchctl", --uid: string = ""] {
  let manifest = open ($closure | path join services.json)
  let uid = if $uid == "" { ^/usr/bin/id -u | str trim } else { $uid }
  let state_file = $home | path join .local state hjem dinit state.json
  mkdir ($state_file | path dirname)
  let state = if ($state_file | path exists) { open $state_file } else { {agent: null, services: {}} }
  retire-launchd $home $uid $launchctl
  if ($manifest.services | is-empty) {
    retire-agent $manifest $home $uid $launchctl
    rm --force $state_file
    return
  }
  let plist = open --raw ($closure | path join agent.plist)
  let fresh = start-agent $manifest $plist $state.agent $home $uid $launchctl
  if $fresh == null {
    save-atomic $state_file ($state | merge {agent: $plist} | to json)
    print "Hjem services: no GUI session; dinit starts at the next login"
    return
  }

  let desired = $manifest.services
  let names = $desired | get name
  let known = $state.services
  mut failed = []
  if not $fresh {
    let removed = $known | columns | where {|name| $name not-in $names }
    let changed = $desired | where {|service| ($known | get --optional $service.name | get --optional file) != $service.file } | get name
    let activated = $desired | where {|service| $service.automatic and ($known | get --optional $service.name | get --optional automatic) != true } | get name
    let before = $names | where {|name| started $manifest $name }

    for name in $changed {
      if not (ctl-ok $manifest reload $name) {
        ctl $manifest stop --force --ignore-unstarted $name | ignore
        if not (ctl-ok $manifest reload $name) { $failed = ($failed | append $name) }
      }
    }
    for name in $removed {
      ctl $manifest stop --force --ignore-unstarted $name | ignore
    }
    $failed = ($failed ++ (unload $manifest $removed))

    let running = $desired | where {|service| started $manifest $service.name } | get name
    mut restarted = []
    mut starts = []
    for service in $desired {
      let rerun = $service.name in $changed or $service.restartOnSwitch
      if $service.name in $failed {
        # dinit keeps the previous description when a reload fails.
        if $service.name in $before and $service.name not-in $running {
          request-start $manifest $service | ignore
        }
      } else if $service.name in $running {
        if $rerun and $service.type != "internal" and $service.name not-in $restarted {
          if (ctl-ok $manifest restart --no-wait --force $service.name) {
            $restarted = ($restarted ++ $service.dependents)
          } else {
            $failed = ($failed | append $service.name)
          }
        }
      } else if $service.name in $before or ($service.automatic and ($rerun or $service.name in $activated)) {
        $starts = ($starts | append $service)
      }
    }
    # Dependents first, so that a dependency is woken by a started dependent.
    for service in ($starts | reverse) {
      if not (request-start $manifest $service) { $failed = ($failed | append $service.name) }
    }
  }

  let failures = $failed
  let applied = $desired | where {|service| $service.name not-in $failures } | reduce --fold {} {|service, recorded|
    $recorded | insert $service.name {file: $service.file, automatic: $service.automatic}
  }
  # A removal that failed stays recorded, so the next run removes it again.
  let services = $failures | where {|name| $name not-in $names } | reduce --fold $applied {|name, recorded|
    $recorded | insert $name ($known | get $name)
  }
  save-atomic $state_file ({agent: $plist, services: $services} | to json)

  if ($failures | is-not-empty) {
    error make {msg: $"Hjem services: failed to apply ($failures | str join ', ')"}
  }
}
