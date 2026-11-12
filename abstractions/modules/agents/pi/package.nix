# Builds the same immutable configuration for Hjem and the standalone launcher.
{
  lib,
  pkgs,
  pi,
  settings,
  keybindings,
  servers,
}: let
  config = pkgs.linkFarm "grimoire-pi-config" (lib.mapAttrsToList (name: value: {
      inherit name;
      path = pkgs.writeText name (builtins.toJSON value);
    }) {
      "settings.json" = settings;
      "keybindings.json" = keybindings;
      "mcp.json" = {mcpServers = servers;};
    });
  package = pkgs.writeShellScriptBin "pi" ''
    set -eu
    # Keep authentication, sessions, trust and caches writable and separate from native Pi.
    agent_dir="''${PI_CODING_AGENT_DIR:-''${XDG_STATE_HOME:-$HOME/.local/state}/grimoire/pi}"
    ${pkgs.coreutils}/bin/mkdir -p -m 700 "$agent_dir"
    agent_dir=$(cd "$agent_dir" && pwd -P)
    # Check every file before replacing any; links already current are left alone.
    stale=
    for file in settings.json keybindings.json mcp.json; do
      path="$agent_dir/$file"
      target=
      if [ -e "$path" ] || [ -L "$path" ]; then
        target=$(${pkgs.coreutils}/bin/readlink "$path" || true)
        case "$target" in
          /nix/store/*-grimoire-pi-config/"$file") ;;
          *) printf 'Refusing to replace unmanaged Pi configuration: %s\n' "$path" >&2; exit 1 ;;
        esac
      fi
      [ "$target" = "${config}/$file" ] || stale=1
    done
    if [ -n "$stale" ]; then
      for file in settings.json keybindings.json mcp.json; do
        ${pkgs.coreutils}/bin/ln -sfn "${config}/$file" "$agent_dir/$file"
      done
    fi
    export PI_CODING_AGENT_DIR="$agent_dir"
    exec ${lib.getExe pi} "$@"
  '';
in {
  inherit config package;
}
