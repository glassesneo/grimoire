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

  hjem.ifEnabled = {
    files."Applications/BetterTouchTool.app" = {
      exclusive = true;
      source = "${cfg.package}/Applications/BetterTouchTool.app";
    };

    platform.darwin.defaults."com.hegenberg.BetterTouchTool".settings = {
      # Use login item to start at login
      launchOnStartup = true;
      SUEnableAutomaticChecks = false;
      SUAutomaticallyUpdate = false;
    };
  };
})
