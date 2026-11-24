def --wrapped main [...args: string] {
  let socket = $env.SSH_AUTH_SOCK? | default ''
  let behavior = $env.FAKE_AGENTS | from json | transpose path behavior | where path == $socket | get --optional 0.behavior
  if $behavior == null or $behavior == dead { exit 2 }
  if $behavior == hang { sleep 30sec }
  $behavior | each {|key| $"($key) comment" } | str join "\n" | print
}
