{delib, ...}: let
  sourceFiles = {
    "src/server/src/ui/qml/launcher/LauncherWindow.qml" = {
      source = ./src/server/src/ui/qml/launcher/LauncherWindow.qml;
      upstreamSha256 = "09863bba71d553a68b81ee9133daba670a3c75ba19f64d64d07e56a71652f260";
    };
    "src/server/src/ui/qml/launcher/LauncherWindowMacOS.qml" = {
      source = ./src/server/src/ui/qml/launcher/LauncherWindowMacOS.qml;
      upstreamSha256 = "1cb72509572ba21058247f0420313c8f551792076399b7e43ad6bb2d12150a44";
    };
  };
in
  delib.module {
    name = "vicinae.compact-transition";
    tests.fixture = ["vicinae"];
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
  }
