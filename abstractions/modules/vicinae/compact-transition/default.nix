{delib, ...}: let
  sourceFiles = {
    "src/server/src/ui/qml/launcher/LauncherWindow.qml" = {
      source = ./src/server/src/ui/qml/launcher/LauncherWindow.qml;
      upstreamSha256 = "535138aef1609e134356a7d5e014e01b57e0a5a4c83095f1e451be6311f80d86";
    };
    "src/server/src/ui/qml/launcher/LauncherWindowMacOS.qml" = {
      source = ./src/server/src/ui/qml/launcher/LauncherWindowMacOS.qml;
      upstreamSha256 = "2fa94318692d0ea498e3db3ad5a6d25ad169f1d3594bf4e44e84b52bf6d3e279";
    };
  };
in
  delib.module {
    name = "vicinae.compact-transition";
    tests.fixture = ["vicinae"];
    meta.description = "Animate the Vicinae launcher window between its compact and expanded states.";

    options.enable = delib.boolOption false;

    myconfig.ifEnabled.source-files.sources.vicinae.files = sourceFiles;

    hjem.ifEnabled = {config, ...}: {
      assertions = [
        {
          assertion = config.vicinae.settings.launcher_window.compact_mode.enabled or false;
          message = "vicinae.compact-transition requires vicinae.settings.launcher_window.compact_mode.enabled; the transition has no effect without compact mode.";
        }
      ];
    };
  }
