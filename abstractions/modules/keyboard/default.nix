{delib, ...}:
delib.module {
  name = "keyboard";
  tests.fixture = ["defaults"];
  meta.description = "Configure system-wide keyboard behavior: key repeat, text substitutions, function keys, and system shortcuts.";

  options.enable = delib.boolOption true;

  darwin.ifEnabled.system.keyboard.enableKeyMapping = false;

  hjem.ifEnabled.platform.darwin.defaults = {
    NSGlobalDomain = {
      settings = {
        AppleKeyboardUIMode = 3; # Full keyboard control
        ApplePressAndHoldEnabled = false;
        InitialKeyRepeat = 12;
        KeyRepeat = 1;
        NSAutomaticCapitalizationEnabled = false;
        NSAutomaticDashSubstitutionEnabled = false;
        NSAutomaticPeriodSubstitutionEnabled = false;
        NSAutomaticQuoteSubstitutionEnabled = false;
        NSAutomaticSpellingCorrectionEnabled = false;
        "com.apple.keyboard.fnState" = false;
      };
      onChange.activateSettings = true;
    };
    "com.apple.symbolichotkeys" = {
      settings.AppleSymbolicHotKeys = {
        "32".enabled = false; # Mission Control: Ctrl + Up
        "34".enabled = false; # Mission Control (slow)
        # Spotlight search: Cmd + Space, left to whatever claims it.
        "64" = {
          enabled = false;
          value = {
            type = "standard";
            parameters = [32 49 1048576];
          };
        };
      };
      onChange.activateSettings = true;
    };
  };
}
