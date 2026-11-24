{delib, ...}:
delib.module {
  name = "locale";
  tests.fixture = ["defaults"];
  meta.description = "Configure the languages and region used by the system and applications.";

  options.enable = delib.boolOption true;

  darwin.ifEnabled = {
    environment.variables.LC_ALL = "en_US.UTF-8";
    system.defaults.CustomSystemPreferences."/Library/Preferences/.GlobalPreferences".AppleICUForce24HourTime = true;
  };

  hjem.ifEnabled.platform.darwin.defaults.NSGlobalDomain = {
    settings = {
      AppleICUForce24HourTime = true;
      AppleLanguages = ["en-US" "ja-JP"];
      AppleLocale = "en_US";
    };
    onChange.activateSettings = true;
  };
}
