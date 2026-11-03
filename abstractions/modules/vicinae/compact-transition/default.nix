{
  delib,
  inputs,
  lib,
  mylib,
  ...
}: let
  sourceFiles = {
    "src/server/src/ui/qml/launcher/LauncherWindow.qml" = {
      source = ./src/server/src/ui/qml/launcher/LauncherWindow.qml;
      upstreamSha256 = "86445284a8cf4093b85127c6ca0d2a1b85b1660f76e3ecebdf1e0cb02582ba79";
    };
    "src/server/src/ui/qml/launcher/LauncherWindowMacOS.qml" = {
      source = ./src/server/src/ui/qml/launcher/LauncherWindowMacOS.qml;
      upstreamSha256 = "ba9682ed35cad11c664e0e5cc34814a6c3ca90547bb760b1c465809b74278384";
    };
  };
in
  delib.module {
    name = "vicinae.compact-transition";
    meta.description = "Animate the Vicinae launcher window between its compact and expanded states.";

    options.enable = delib.boolOption false;

    myconfig.ifEnabled.vicinae.sourceFiles = sourceFiles;

    hjem.ifEnabled = {config, ...}: {
      assertions = [
        {
          assertion = config.vicinae.settings.launcher_window.compact_mode.enabled or false;
          message = "vicinae.compact-transition requires vicinae.settings.launcher_window.compact_mode.enabled; the transition has no effect without compact mode.";
        }
      ];
    };

    tests = {system, ...}: {
      # The replacements were written against the files of the locked upstream source.
      upstream = mylib.sourceFiles.upstreamCase inputs.vicinae.packages.${system}.default.src sourceFiles;
      requires-compact-mode = {
        uses = ["vicinae" "app-identity" "colorscheme"];
        host.myconfig.ifEnabled.vicinae = {
          enable = true;
          compact-transition.enable = true;
        };
        modules.fixture.hjem.always.vicinae.settings.launcher_window.compact_mode.enabled = lib.mkForce false;
        fails = "requires vicinae.settings.launcher_window.compact_mode.enabled";
      };
    };
  }
