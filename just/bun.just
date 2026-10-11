# Package names are passed as separate arguments, which Nushell's `-c` cannot
# receive, so these recipes run under sh and forward them with "$@".
set shell := ["sh", "-cu"]
set positional-arguments
export bun := justfile_directory() / 'scripts' / 'bun.nu'

# Add packages and regenerate bun.nix; see just --list for shared Bun requirements and effects.
[arg('manifest', help='Existing package.json; relative paths resolve from the invoking directory')]
[arg('packages', help='Package names and flags forwarded to bun add')]
[no-cd]
add manifest +packages:
  nu --no-config-file "$bun" add "$@"

# Remove packages and regenerate bun.nix; see just --list for shared Bun requirements and effects.
[arg('manifest', help='Existing package.json; relative paths resolve from the invoking directory')]
[arg('packages', help='Package names and flags forwarded to bun remove')]
[no-cd]
remove manifest +packages:
  nu --no-config-file "$bun" remove "$@"

# Update packages (default: all) and regenerate bun.nix; see just --list for shared Bun requirements and effects.
[arg('manifest', help='Existing package.json; relative paths resolve from the invoking directory')]
[arg('packages', help='Package names and flags forwarded to bun update, within package.json ranges')]
[no-cd]
update manifest *packages:
  nu --no-config-file "$bun" update "$@"

# Run bun install after a manual manifest edit and regenerate bun.nix; see just --list for shared Bun requirements and effects.
[arg('manifest', help='Existing package.json; relative paths resolve from the invoking directory. No further arguments accepted')]
[no-cd]
sync manifest:
  nu --no-config-file "$bun" sync "$@"
