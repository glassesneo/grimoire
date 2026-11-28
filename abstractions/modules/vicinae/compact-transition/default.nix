{delib, ...}:
delib.module {
  name = "vicinae.compact-transition";
  tests.fixture = ["vicinae"];
  meta.description = "Animate the Vicinae launcher window between its compact and expanded states.";

  options.enable = delib.boolOption false;

  myconfig.ifEnabled.vicinae.patches = [./compact-transition.patch];

  hjem.ifEnabled = {config, ...}: {
    assertions = [
      {
        assertion = config.vicinae.settings.launcher_window.compact_mode.enabled or false;
        message = "vicinae.compact-transition requires vicinae.settings.launcher_window.compact_mode.enabled; the transition has no effect without compact mode.";
      }
    ];
  };
}
