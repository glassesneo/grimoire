{delib, ...}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "bettertouchtool";
  tests.fixture = ["defaults" "exclusive"];
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
      launchOnStartup = true;
      SUEnableAutomaticChecks = false;
      SUAutomaticallyUpdate = false;
    };
  };
})
