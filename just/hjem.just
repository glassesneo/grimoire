set shell := ["nu", "-c"]
export flake := justfile_directory()
export apply := justfile_directory() / 'scripts' / 'apply.nu'

# Build $USER's Hjem preflight (files, packages, services) without activating the configuration.
[arg('host', help='Denix host to build; defaults to this machine via hostname -s')]
build $host=`hostname -s`:
  nix build --no-link $'($env.flake)#hjemConfigurations."($env.USER)@($env.host)".preflight'

[arg('host', help='Denix configuration name; defaults to hostname -s. A different host requires --target')]
[arg('target', long, help='SSH destination; takes precedence over local application. Omit only for this machine')]
[doc('''
  Apply Hjem files/packages, then reconcile services as the same target user.
  Preflight failure leaves the existing home unchanged; activation or service
  failure can leave partial changes. See docs/operations.md for service ownership
  and retry behavior. Hjem uses $USER locally and the SSH user remotely.
  Remote application builds locally, copies closures and flake source over ssh-ng
  (closure copying skips signature checks), then activates over SSH.
''')]
switch $host=`hostname -s` $target='':
  use {{ quote(apply) }} *; hjem $env.host --target $env.target
