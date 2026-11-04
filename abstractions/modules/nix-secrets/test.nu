use std/assert

# Keep execution checks here: CLI command lookup must return the manifest, and
# real ciphertext must remain unpublished on missing-key or forged-anchor failure.
# Evaluation cannot detect these package failures; Hjem owns service lifecycle.
# Mount inspection is read-only: this sandbox creates no jobs, mounts or images.
def main [manifest_path: path, environment_path: path, probe: path, package: path] {
  let manifest = open $manifest_path
  let environment = open $environment_path
  let command = $environment.NIX_SECRETS_NIX_EVAL_COMMAND | split row ' '
  let lookup = run-external ...$command | complete
  assert equal $lookup.exit_code 0 $lookup.stderr
  assert equal ($lookup.stdout | from json) $manifest

  let home = mktemp --directory | path expand
  try {
    let key = $home | path join key.txt
    let generated = ^($probe | path join keygen) -o $key | complete
    assert equal $generated.exit_code 0 $generated.stderr
    let recipient = open --raw $key | parse --regex '(?m)^# public key: (?<key>.+)$' | get 0.key
    let storage = $home | path join storage
    mkdir $storage
    let encrypted = 'dummy-missing-key' | ^($probe | path join age) -r $recipient -o ($storage | path join dummy.enc) | complete
    assert equal $encrypted.exit_code 0 $encrypted.stderr
    let saved = $home | path join key.saved
    mv $key $saved
    let generations = $home | path join generations
    let published = $home | path join published
    let activation_manifest = $home | path join manifest.json
    $manifest | merge {
      storage: $storage
      identityPaths: [$key]
      generationsDir: $generations
      secrets: [($manifest.secrets.0 | merge {path: $published})]
    } | to json | save $activation_manifest

    let missing = ^$package activate $activation_manifest --needed-for-users false | complete
    assert not equal $missing.exit_code 0
    assert str contains $missing.stderr 'Failed to decrypt secret'
    assert (not ($published | path exists))
    assert (not ($generations | path exists))

    mv $saved $key
    mkdir $generations
    let anchor = $generations | path join nix-secrets-anchor
    touch $anchor
    let native = ^/sbin/mount | complete
    assert equal $native.exit_code 0 $native.stderr
    let forged = with-env {PATH: '/usr/bin:/bin:/usr/sbin:/sbin'} {
      ^$package activate $activation_manifest --needed-for-users false | complete
    }
    assert not equal $forged.exit_code 0
    assert str contains $forged.stderr 'Failed to check for secret generation existence'
    assert equal (ls --all $generations | get name) [$anchor]
    assert (not ($published | path exists))
  } finally {
    rm --recursive --permanent $home
  }
}
