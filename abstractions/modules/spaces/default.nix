{delib, ...}:
delib.module {
  name = "spaces";
  tests.fixture = ["defaults"];
  meta.description = "Configure Spaces across displays and how the desktop and its widgets are revealed.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled.platform.darwin.defaults = {
    # Takes effect at the next login.
    "com.apple.spaces".settings.spans-displays = 0;
    NSGlobalDomain = {
      settings.AppleSpacesSwitchOnActivate = true;
      onChange.activateSettings = true;
    };
    "com.apple.WindowManager" = {
      settings = {
        EnableStandardClickToShowDesktop = 0;
        HideDesktop = 0;
        StageManagerHideWidgets = 0;
        StandardHideDesktopIcons = 0;
        StandardHideWidgets = 0;
      };
      onChange.restartProcesses = ["WindowManager"];
    };
  };
}
