# A launchctl with one gui domain for the reconciler test. A loaded job has a
# `<label>.loaded` file under FAKE_LAUNCHD and, while running, a `<label>.pid`
# file; running a job runs FAKE_AGENT, whatever its plist holds, as launchd
# does at load and on kickstart. As launchd, it finishes removing a job after
# bootout returns: the next calls still see it loaded, without a process, and
# can neither bootstrap nor kickstart it. The file `no-gui` there removes the gui domain. Calls
# are appended to `calls`.
def spawn [pidfile: path] {
  ^sh -c 'nohup "$0" >/dev/null 2>&1 & echo $!' $env.FAKE_AGENT | str trim | save --force $pidfile
}

def main [...args: string] {
  let state = $env.FAKE_LAUNCHD
  $"($args | str join ' ')\n" | save --append ($state | path join calls)
  let parts = $args.1 | split row /
  let label = if ($parts | length) == 3 { $parts.2 } else { $args | get --optional 2 | default '' | path parse | get stem }
  let loadedfile = $state | path join $"($label).loaded"
  let pidfile = $state | path join $"($label).pid"
  let removing = $state | path join $"($label).removing"
  let gui = not ($state | path join no-gui | path exists)
  let pending = if ($removing | path exists) { open --raw $removing | into int } else { 0 }
  if $pending > 0 { $"($pending - 1)" | save --force $removing }
  let loaded = ($loadedfile | path exists) or $pending > 0
  let pid = if ($pidfile | path exists) { open --raw $pidfile | str trim }
  let running = $pid != null and ((^kill -0 $pid | complete).exit_code == 0)
  match $args.0 {
    print => {
      if ($parts | length) == 2 { if $gui { exit 0 } else { exit 1 } }
      if not $loaded { exit 1 }
      print "state = loaded"
      if $running { print $"\tpid = ($pid)" }
    }
    bootstrap => {
      if not $gui or $loaded { exit 5 }
      touch $loadedfile
      spawn $pidfile
    }
    kickstart => {
      if not ($loadedfile | path exists) { exit 113 }
      if not $running { spawn $pidfile }
    }
    bootout => {
      if not $loaded { exit 3 }
      if $running {
        ^kill $pid
        while (^kill -0 $pid | complete).exit_code == 0 { sleep 50ms }
      }
      rm --force $pidfile $loadedfile
      '3' | save --force $removing
    }
    _ => { exit 64 }
  }
}
