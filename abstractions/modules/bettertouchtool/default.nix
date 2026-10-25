{delib, ...}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "bettertouchtool";
  meta = {
    description = "Provide BetterTouchTool.";
    tags = ["gui"];
  };

  options = with delib; {
    enable = boolOption false;
    package = packageOption myconfig.casks.packages.bettertouchtool;
  };

  hjem.ifEnabled = {config, ...}: {
    files."Applications/BetterTouchTool.app" = {
      exclusive = true;
      source = "${cfg.package}/Applications/BetterTouchTool.app";
    };

    userServices.bettertouchtool.command = [
      "/usr/bin/open"
      "-gj"
      "-a"
      "${config.directory}/Applications/BetterTouchTool.app"
    ];
    # Only the gui domain is loaded at login.
    platform.darwin.launchAgents.bettertouchtool.domain = "gui";
  };
})
