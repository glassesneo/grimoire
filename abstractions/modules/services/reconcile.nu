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
    mut restarts = []
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
            $restarts = ($restarts | append $service.name)
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
    let refused = $failed
    let started = $starts | get --optional name | default [] | where {|name| $name not-in $refused }
    let requests = [
      (if ($restarts | is-not-empty) { $"restart requested for ($restarts | str join ', ')" })
      (if ($started | is-not-empty) { $"start requested for ($started | str join ', ')" })
    ] | compact
    if ($requests | is-not-empty) {
      print $"Hjem services: ($requests | str join '; '). These requests are not awaited: `dinitctl status <name>` shows whether each came up."
    }
  } else {
    print "Hjem services: dinit started and starts the automatic services itself; `dinitctl list` shows their state."
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
    error make {msg: $"Hjem services: failed to apply ($failures | str join ', '). The other services were applied, and the next switch retries these. dinit logs to ~/Library/Logs/dinit.log."}
  }
}
