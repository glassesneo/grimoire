set shell := ["nu", "-c"]
export flake := justfile_directory()
export apply := justfile_directory() / 'scripts' / 'apply.nu'

# Build the nix-darwin system without activating it or changing the active system configuration.
[arg('host', help='Denix host to build; defaults to this machine via hostname -s')]
build $host=`hostname -s`:
  nix build --no-link $'($env.flake)#darwinConfigurations."($env.host)".system'

[arg('host', help='Denix configuration name; defaults to hostname -s. A different host requires --target')]
[arg('target', long, help='SSH destination; takes precedence over local application. Omit only for this machine')]
[doc('''
  Set the system profile and activate nix-darwin with sudo on the target machine.
  Builds locally; with --target, copies the closure over ssh-ng without signature
  checks and activates over SSH. Does not apply Hjem.
''')]
switch $host=`hostname -s` $target='':
  use {{ quote(apply) }} *; darwin $env.host --target $env.target
