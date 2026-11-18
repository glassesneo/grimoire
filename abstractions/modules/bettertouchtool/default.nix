{delib, ...}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "bettertouchtool";
  tests.fixture = ["defaults" "exclusive"];
  meta = {
    description = "Provide BetterTouchTool and own its portable configuration.";
    tags = ["gui"];
  };

  options = with delib; {
    enable = boolOption false;
    package = packageOption myconfig.casks.packages.bettertouchtool;
  };

  hjem.ifEnabled = {pkgs, ...}: let
    app = "${cfg.package}/Applications/BetterTouchTool.app";
  in {
    packages = [
      (pkgs.linkFarm "bttcli" {"bin/bttcli" = "${app}/Contents/SharedSupport/bin/bttcli";})
    ];

    files."Applications/BetterTouchTool.app" = {
      exclusive = true;
      source = app;
    };

    xdg.config.files."bettertouchtool/Default.bttpreset" = {
      exclusive = true;
      source = ./presets/default.bttpreset;
    };

    platform.darwin.defaults."com.hegenberg.BetterTouchTool".settings = {
      launchOnStartup = true;
      SUEnableAutomaticChecks = false;
      SUAutomaticallyUpdate = false;
    };
  };
})
