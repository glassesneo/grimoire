# Build or apply the standalone Hjem configuration: just hjem <build|switch> [host]
mod hjem 'just/hjem.just'

# Build or apply the nix-darwin configuration: just darwin <build|switch> [host]
mod darwin 'just/darwin.just'

# Build or apply every layer of a host in order: just all <build|switch> [host]
mod all 'just/all.just'

# Import an unapplied flake source from another machine.
mod candidate 'just/candidate.just'

# List, compare, or update modules' pinned dependencies: just anchors <list|outdated|update> [module]
mod anchors 'just/anchors.just'

[doc('''
  Change a Bun project's dependencies and regenerate its bun.nix.
  Requires bun and bun2nix from the development shell and contacts the npm registry.
  Each operation runs in the manifest's directory and may create ignored node_modules.
  bun.nix is raw bun2nix output; nix fmt leaves it unchanged. Running Bun directly
  can leave it stale; the bun-lock check rejects this until just bun sync is run.
  package.json must not use a lifecycle script to regenerate bun.nix.
''')]
mod bun 'just/bun.just'

# Format repository files with nix fmt (treefmt).
fmt:
  nix fmt

# Regenerate docs/generated/authoring.md from declarations without staging it.
docs:
  nu --no-config-file scripts/docs.nu

# Show a module's options, including those it adds to other module systems.
[arg('module', help='Module name, as listed under Modules in docs/generated/authoring.md')]
options module:
  nix eval --raw --no-update-lock-file '.#lib.moduleOptions."{{ module }}"'

# Evaluate flake checks without building or updating the lock file.
eval:
  nix flake check --no-build --no-update-lock-file

# Build one flake check for the current system.
[arg('name', help='Check name under checks.<system>, including module-<name> for inline module checks')]
check name:
  nix build --no-link --no-update-lock-file ".#checks.$(nix eval --impure --raw --expr builtins.currentSystem).\"{{ name }}\""

# Run all current-system checks, including formatting and reference freshness, on the tracked working tree.
check-full:
  nu --no-config-file scripts/gate.nu

[doc('''
  Check nix-secrets against this Mac's launchd, dinit and RAM disks, outside the
  sandbox, with dummy keys and a probe LaunchAgent it removes afterwards. Needs a
  GUI login session. Run it after changing nix-secrets, its patches, Hjem or the
  services wiring, after a macOS upgrade, and before first use on a new machine.
''')]
nix-secrets-smoke:
  nu --no-config-file scripts/nix-secrets-smoke.nu
