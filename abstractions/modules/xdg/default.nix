{
  delib,
  lib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: let
  kinds = {
    cache = "XDG_CACHE_HOME";
    config = "XDG_CONFIG_HOME";
    data = "XDG_DATA_HOME";
    state = "XDG_STATE_HOME";
  };
in {
  name = "xdg";
  meta.description = "Define the user's XDG base directories and export them to the user's environment.";

  options = with delib; let
    home = myconfig.host.user.homeDirectory;
  in {
    enable = boolOption true;
    cache = readOnly (strOption "${home}/.cache" {
      defaultText = lib.literalExpression ''"''${myconfig.host.user.homeDirectory}/.cache"'';
      description = "The user's XDG cache directory.";
    });
    config = readOnly (strOption "${home}/.config" {
      defaultText = lib.literalExpression ''"''${myconfig.host.user.homeDirectory}/.config"'';
      description = "The user's XDG configuration directory.";
    });
    data = readOnly (strOption "${home}/.local/share" {
      defaultText = lib.literalExpression ''"''${myconfig.host.user.homeDirectory}/.local/share"'';
      description = "The user's XDG data directory.";
    });
    state = readOnly (strOption "${home}/.local/state" {
      defaultText = lib.literalExpression ''"''${myconfig.host.user.homeDirectory}/.local/state"'';
      description = "The user's XDG state directory.";
    });
  };

  # Hjem exports a variable only when its directory differs from Hjem's
  # default, so the variables are set explicitly.
  hjem.ifEnabled = {
    xdg = lib.mapAttrs (kind: _: {directory = cfg.${kind};}) kinds;
    environment.sessionVariables = lib.mapAttrs' (kind: variable: lib.nameValuePair variable cfg.${kind}) kinds;
  };

  # Hjem results do not expose the environment, so a fixture file carries it.
  checks = {pkgs, ...}: {
    exported = {
      uses = ["host"];
      modules.fixture.hjem.always = {config, ...}: {
        files."load-env".source = config.environment.loadEnv;
      };
      build = result: let
        loadEnv = (lib.findFirst (file: lib.hasSuffix "/load-env" file.target) (throw "Missing load-env") result.manifest.files).source;
      in
        pkgs.runCommand "xdg-exported" {inherit loadEnv;} ''
          grep -qx 'export XDG_CACHE_HOME="/tmp/module-checks/.cache"' "$loadEnv"
          grep -qx 'export XDG_CONFIG_HOME="/tmp/module-checks/.config"' "$loadEnv"
          grep -qx 'export XDG_DATA_HOME="/tmp/module-checks/.local/share"' "$loadEnv"
          grep -qx 'export XDG_STATE_HOME="/tmp/module-checks/.local/state"' "$loadEnv"
          touch "$out"
        '';
    };
  };
})
