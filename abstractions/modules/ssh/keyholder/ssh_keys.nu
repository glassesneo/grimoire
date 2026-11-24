def declared []: nothing -> table {
  $env.SSH_KEYS | from json | transpose purpose key | flatten
}

def identities []: nothing -> table {
  ^/usr/sbin/sc_auth list-ctk-identities -t ssh
    | lines
    | skip 1
    | parse --regex '^(?<type>\S+)\s+(?<fingerprint>SHA256:\S+)\s+(?<protection>\S+)\s+(?<label>\S+)\s.*\s(?<valid>YES|NO)\s*$'
}

def fingerprint [public_key: string]: nothing -> string {
  $"($public_key)\n" | ^/usr/bin/ssh-keygen -lf - | split row ' ' | get 1
}

def problems []: nothing -> list<string> {
  let present = identities
  declared | each {|key|
    let identity = $present | where label == $key.label | get --optional 0
    let file = $key.handle
    let pair = $key.publicKey | split row ' ' | first 2 | str join ' '
    let handle_pair = if ($"($file).pub" | path exists) { open --raw $"($file).pub" | split row ' ' | first 2 | str join ' ' }
    [
      (if $identity == null { $"Secure Enclave has no identity ($key.label) for ssh.keys.($key.purpose); run ssh-keys create" })
      (if $identity != null and $identity.fingerprint != (fingerprint $key.publicKey) { $"identity ($key.label) is not the key ssh.keys.($key.purpose) declares" })
      (if $identity != null and $identity.valid != YES { $"identity ($key.label) is no longer valid" })
      (if not ($file | path exists) or $handle_pair != $pair { $"($file) is missing or not the handle of ($key.label); run ssh-keys create" })
      (if ($key.expires | into datetime) - (date now) < 30day { $"identity ($key.label) expires on ($key.expires); rotate it" })
    ] | compact
  } | flatten
}

def check []: nothing -> int {
  let found = problems
  $found | each {|problem| print --stderr $"warning: ($problem)" } | ignore
  if ($found | is-empty) { 0 } else { 1 }
}

def create [] {
  let present = identities | get label
  for key in (declared | where label not-in $present) {
    ^/usr/sbin/sc_auth create-ctk-identity -l $key.label -k p-256-ne -t none
  }
  let work = mktemp --directory
  do {
    cd $work
    ^/usr/bin/ssh-keygen -w $env.SSH_KEY_PROVIDER -K -N ''
  }
  for key in (declared) {
    let source = $work | path join $"id_ecdsa_sk_rk_($key.label)"
    if ($source | path exists) {
      ^install -m 600 $source $key.handle
      ^install -m 644 $"($source).pub" $"($key.handle).pub"
    }
  }
  rm --recursive --force $work
  print 'Put any new public key in ssh.keys and register it where it is used (GitHub, then a switch for the remote hosts).'
}

def main [command: string = check] {
  match $command {
    check => { exit (check) }
    create => { create; exit (check) }
    _ => {
      print --stderr 'usage: ssh-keys [check|create]'
      exit 2
    }
  }
}
