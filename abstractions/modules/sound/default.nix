{delib, ...}:
delib.module {
  name = "sound";
  requires = ["defaults"];
  meta.description = "Configure system sounds and alert feedback.";

  options.enable = delib.boolOption true;

  darwin.ifEnabled.system.startup.chime = false;

  hjem.ifEnabled.platform.darwin.defaults = {
    NSGlobalDomain = {
      settings = {
        "com.apple.sound.beep.volume" = 0.0;
        "com.apple.sound.beep.feedback" = 0; # No sound when changing the volume
      };
      onChange.activateSettings = true;
    };
    "com.apple.universalaccess".settings.flashScreen = false;
  };
}
