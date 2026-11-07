# Explicit live macOS compatibility check, not a sandboxed check or host switch.
# Synthetic input crosses the actual Hjem backend; a separate consumer reads the
# configured output. Native plutil decodes disk metadata; finally owns cleanup.
# Wiring, missing keys and ordinary-directory markers are covered by the
# sandboxed module-nix-secrets check; this script needs actual launchd and mounts.
use std/assert

# `checked` keeps synthetic plaintext, which commands print, out of errors.
use ./run.nu checked

# Applies the probe's services step, which starts the probe's dinit instance,
# and waits until its activation service has started or, when FAILS, failed.
def apply [probe: path, --fails] {
  let services = $probe | path join services | path expand
  checked ($services | path join bin apply) | ignore
  let manifest = open ($services | path join services.json)
  let state = if $fails { 'is-failed' } else { 'is-started' }
  for _ in 0..<60 {
    let status = ^$manifest.dinitctl --socket-path $manifest.socket --quiet $state nix-secrets-activate | complete
    if $status.exit_code == 0 { return }
    sleep 500ms
  }
  error make {msg: $'Activation did not reach ($state)'}
}

# Links the probe's dinit descriptions where Hjem would place them.
def describe [probe: path, home: path] {
  mkdir ($home | path join .config)
  ^ln -s ($probe | path join services dinit.d | path expand) ($home | path join .config dinit.d)
}

def consumer [secret: path, expected: string] {
  # cat is a separate app process receiving a path, not plaintext in argv/env.
  assert equal (checked /bin/cat $secret) $expected
}

def encrypt [probe: path, home: path, recipient: string, value: string] {
  let ciphertext = $home | path join storage dummy.enc
  rm --permanent --force $ciphertext
  $value | checked ($probe | path join age) -r $recipient -o $ciphertext | ignore
}

def unmount [home: path] {
  let generations = $home | path join generations
  let devices = checked /sbin/mount | lines | parse '{device} on {mountpoint} ({options})' | where mountpoint == $generations | get device
  if ($devices | is-empty) { return }
  assert equal ($devices | length) 1
  let info = checked /usr/bin/hdiutil info -plist | checked /usr/bin/plutil -convert json -o - -- - | from json
  let owned = $info.images | any {|image|
    ((($image.image-path | str starts-with 'ram://') or $image.image-path == ($home | path join disk.dmg)) and
      ($image.system-entities | any {|entity|
        $entity.dev-entry == $devices.0 and $entity.mount-point? == $generations
      }))
  }
  assert $owned 'Refusing to unmount an unverified test device'
  checked /sbin/umount $generations | ignore
  checked /usr/bin/hdiutil detach $devices.0 | ignore
}

def main [] {
  const root = path self | path dirname | path dirname
  cd $root
  let uid = checked /usr/bin/id -u
  let username = checked /usr/bin/id -un
  let label = 'org.hjem.nix-secrets-probe'
  let domain = $'gui/($uid)/($label)'
  for kind in [user gui] {
    let status = ^/bin/launchctl print $'($kind)/($uid)/($label)' | complete
    assert ($status.exit_code != 0) $'Existing job: ($label)'
  }
  let home = checked /usr/bin/mktemp -d /tmp/hjem-nix-secrets-XXXXXXXX | path expand
  try {
    let fields = $'homeDirectory = ($home | to json -r); username = ($username | to json -r);'
    let expr = 'import ./scripts/nix-secrets-smoke.nix { flake = builtins.getFlake (toString ./.); ' + $fields + ' }'
    let probe = checked nix build --impure --no-link --print-out-paths --expr $expr
    let secret = open --raw ($probe | path join secret-path)
    mkdir ($home | path join storage)
    let key = $home | path join key.txt
    checked ($probe | path join keygen) -o $key | ignore
    let recipient = open --raw $key | parse --regex '(?m)^# public key: (?<key>.+)$' | get 0.key

    encrypt $probe $home $recipient dummy-first

    let generations = $home | path join generations
    let anchor = $generations | path join nix-secrets-anchor
    let disk = $home | path join disk.dmg
    checked /usr/bin/hdiutil create -size 8m -fs HFS+ -volname nix-secrets-probe $disk | ignore
    mkdir $generations
    checked /usr/bin/hdiutil attach -nobrowse -mountpoint $generations $disk | ignore
    touch $anchor
    describe $probe $home
    apply $probe --fails
    assert (not ($secret | path exists))
    assert equal (ls -a $generations | get name) [$anchor]
    unmount $home
    rm --permanent $generations
    print 'PASS: mounted disk-backed HFS with an anchor is rejected'

    apply $probe
    consumer $secret dummy-first
    assert equal ($secret | path type) symlink
    assert equal (checked /usr/bin/stat -L -f '%Lp %u' $secret) $'400 ($uid)'
    print 'PASS: the dinit service creates RAM disk and consumer reads secret (0400)'

    encrypt $probe $home $recipient dummy-second
    checked ($probe | path join activate) | ignore
    consumer $secret dummy-second
    print 'PASS: existing RAM mount is verified and consumer reads updated value'

    # A new dinit instance stands for the next login.
    checked /bin/launchctl bootout $domain | ignore
    unmount $home
    apply $probe
    consumer $secret dummy-second
    print 'PASS: a new dinit instance recreates a fresh verified RAM mount'
  } finally {
    # apply can fail after bootstrap: inspect actual ownership, not a flag.
    let status = ^/bin/launchctl print $domain | complete
    if $status.exit_code == 0 {
      let paths = $status.stdout | parse --regex '(?m)^\s*path = (?<path>.+)$' | get path
      assert equal $paths [($home | path join Library LaunchAgents $'($label).plist')]
      checked /bin/launchctl bootout $domain | ignore
    }
    unmount $home
    rm --permanent --recursive $home
    let status = ^/bin/launchctl print $domain | complete
    assert ($status.exit_code != 0)
  }
}
