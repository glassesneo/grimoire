system := `nix eval --impure --raw --expr builtins.currentSystem`

# Build or apply the standalone Hjem configuration: just hjem <build|switch> [host]
mod hjem 'just/hjem.just'

# Build or apply the nix-darwin configuration: just darwin <build|switch> [host]
mod darwin 'just/darwin.just'

# Build or apply every layer of a host in order: just all <build|switch> [host]
mod all 'just/all.just'

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

# Evaluate flake checks without building or updating the lock file.
eval:
  nix flake check --no-build --no-update-lock-file

# Build one flake check for the current system; see docs/operations.md for platform and live-check limits.
[arg('name', help='Check name under checks.<system>, including module-<name> for inline module checks')]
check name:
  nix build --no-link --no-update-lock-file '.#checks.{{ system }}."{{ name }}"'

# Run all current-system checks, including formatting and reference freshness, on the tracked working tree.
check-full:
  nix flake check --no-update-lock-file
