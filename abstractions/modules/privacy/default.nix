{delib, ...}:
delib.module {
  name = "privacy";
  meta.description = "Limit what the system shares and what it opens without being asked.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled.platform.darwin.defaults = {
    "com.apple.AdLib".settings.allowApplePersonalizedAdvertising = false;
    # Image Capture does not open when a device is connected.
    "com.apple.ImageCapture".settings.disableHotPlug = true;
  };
}
