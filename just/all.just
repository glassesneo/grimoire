set shell := ["nu", "-c"]
export flake := justfile_directory()
export apply := justfile_directory() / 'scripts' / 'apply.nu'

# Build the nix-darwin system and $USER's Hjem preflight without activating either configuration.
[arg('host', help='Denix host to build; defaults to this machine via hostname -s')]
build $host=`hostname -s`:
  nix build --no-link $'($env.flake)#darwinConfigurations."($env.host)".system' $'($env.flake)#hjemConfigurations."($env.USER)@($env.host)".preflight'

[arg('host', help='Denix configuration name; defaults to hostname -s. A different host requires --target')]
[arg('target', long, help='SSH destination; takes precedence over local application. Omit only for this machine')]
[arg('source', long='flake', help='Local candidate store path; defaults to the recipe checkout')]
[doc('''
  Apply nix-darwin, then Hjem, stopping at the first failure without rollback.
  just --list darwin and just --list hjem describe each layer.
''')]
switch $host=`hostname -s` $target='' $source='':
  use {{ quote(apply) }} *; all $env.host --target $env.target --flake $env.source
