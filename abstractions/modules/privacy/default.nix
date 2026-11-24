{delib, ...}:
delib.module {
  name = "privacy";
  tests.fixture = ["defaults"];
  meta.description = "Limit what the system shares and what it opens without being asked.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled.platform.darwin.defaults = {
    "com.apple.AdLib".settings.allowApplePersonalizedAdvertising = false;
    "com.apple.ImageCapture".settings.disableHotPlug = true;
  };
}
