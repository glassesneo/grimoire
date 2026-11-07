{delib, ...}:
delib.module {
  name = "appearance";
  tests.fixture = ["defaults"];
  meta.description = "Configure the system's visual appearance: color scheme, menu bar, and menu bar clock.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled.platform.darwin.defaults = {
    NSGlobalDomain = {
      settings = {
        AppleInterfaceStyle = "Dark";
        _HIHideMenuBar = true;
      };
      onChange.activateSettings = true;
    };
    "com.apple.menuextra.clock" = {
      settings = {
        IsAnalog = false;
        Show24Hour = true;
        ShowDate = 1; # Always
        ShowDayOfMonth = true;
        ShowDayOfWeek = true;
        ShowSeconds = false;
      };
      onChange.restartProcesses = ["ControlCenter"];
    };
  };
}
