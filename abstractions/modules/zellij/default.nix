{
  delib,
  lib,
  mylib,
  ...
}:
delib.module {
  name = "zellij";
  meta.description = "Provide and configure the Zellij terminal multiplexer, and own its configuration file.";

  options.enable = delib.boolOption true;

  hjem.always.options.zellij = {
    keybinds =
      mylib.fragments.option
      // {
        description = "KDL `bind` nodes rendered into the `shared` section of Zellij's keybindings, which replace Zellij's default keybindings.";
      };
    pluginPermissions = lib.mkOption {
      type = with lib.types;
        attrsOf (listOf (enum [
          "ReadApplicationState"
          "ChangeApplicationState"
          "OpenFiles"
          "RunCommands"
          "OpenTerminalsOrPlugins"
          "WriteToStdin"
          "WebAccess"
          "ReadCliPipes"
          "MessageAndLaunchOtherPlugins"
          "Reconfigure"
          "FullHdAccess"
          "StartWebServer"
          "InterceptInput"
          "ReadPaneContents"
          "RunActionsAsUser"
          "WriteToClipboard"
          "ReadSessionEnvironmentVariables"
        ]));
      default = {};
      description = "Permissions granted to plugins, by the absolute path of the plugin's wasm file. When any are declared, they replace Zellij's permission cache, which Zellij can then no longer write, so a plugin that is not declared asks for its permissions in every session.";
    };
  };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    permissions = config.zellij.pluginPermissions;
    permissionsFile = {
      exclusive = true;
      text = lib.concatStrings (lib.mapAttrsToList (plugin: granted:
        "${builtins.toJSON plugin} {\n"
        + lib.concatMapStrings (permission: "    ${permission}\n") granted
        + "}\n")
      permissions);
    };
  in {
    packages = [pkgs.zellij];

    # Zellij keeps the cache in the platform's cache directory, which on
    # Darwin is not XDG_CACHE_HOME.
    files = lib.mkIf (pkgs.stdenv.hostPlatform.isDarwin && permissions != {}) {
      "Library/Caches/org.Zellij-Contributors.Zellij/permissions.kdl" = permissionsFile;
    };
    xdg.cache.files = lib.mkIf (!pkgs.stdenv.hostPlatform.isDarwin && permissions != {}) {
      "zellij/permissions.kdl" = permissionsFile;
    };

    xdg.config.files = {
      "zellij/config.kdl" = {
        exclusive = true;
        source = pkgs.replaceVars ./config.kdl {
          keybinds = mylib.fragments.render config.zellij.keybinds;
        };
      };
      # Replaces the built-in default layout, which also serves as the
      # template of new tabs.
      "zellij/layouts/default.kdl" = {
        exclusive = true;
        source = ./layouts/default.kdl;
      };
    };
  };

  checks = {
    pkgs,
    home,
    ...
  }: let
    configDir = "${home}/fixture-config";
  in {
    valid-config = {
      modules.fixture.hjem.always = {
        xdg.config.directory = configDir;
        zellij.keybinds.fixture.text = ''bind "Super x" { CloseFocus; }'';
      };
      build = result: let
        source = target:
          (lib.findFirst (file: file.target == target)
            (throw "Missing fixture file ${target}")
            result.manifest.files).source;
      in
        pkgs.runCommand "zellij-valid-config" {
          config = source "${configDir}/zellij/config.kdl";
          nativeBuildInputs = [pkgs.zellij];
        } ''
          export HOME=$TMPDIR
          zellij --config "$config" setup --check
          grep -F 'bind "Super x" { CloseFocus; }' "$config"
          touch "$out"
        '';
    };

    permissions-cache = {
      modules.fixture.hjem.always.zellij.pluginPermissions."/fixture/plugin.wasm" = ["ReadApplicationState" "WriteToStdin"];
      build = result: let
        file =
          lib.findFirst (file: lib.hasSuffix "/permissions.kdl" file.target)
          (throw "Missing fixture permissions.kdl")
          result.manifest.files;
      in
        pkgs.runCommand "zellij-permissions-cache" {
          inherit (file) source;
          expected = pkgs.writeText "expected" ''
            "/fixture/plugin.wasm" {
                ReadApplicationState
                WriteToStdin
            }
          '';
        } ''
          diff -u "$expected" "$source"
          touch "$out"
        '';
    };
  };
}
