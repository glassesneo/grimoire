{delib, ...}:
delib.module {
  name = "trackpad";
  tests.fixture = ["defaults"];
  meta.description = "Configure pointing devices: trackpad clicking and gestures, scrolling, and pointer speed.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled.platform.darwin.defaults = let
    trackpad = {
      settings = {
        ActuationStrength = 1;
        Clicking = false;
        Dragging = false;
        TrackpadRightClick = false;
        TrackpadThreeFingerDrag = false;
        TrackpadThreeFingerTapGesture = 0;
        TrackpadThreeFingerHorizSwipeGesture = 0;
        TrackpadThreeFingerVertSwipeGesture = 0;
        TrackpadFourFingerHorizSwipeGesture = 2;
        TrackpadFourFingerVertSwipeGesture = 2;
      };
      onChange.activateSettings = true;
    };
  in {
    "com.apple.AppleMultitouchTrackpad" = trackpad;
    "com.apple.driver.AppleBluetoothMultitouch.trackpad" = trackpad;
    NSGlobalDomain = {
      settings = {
        AppleEnableMouseSwipeNavigateWithScrolls = true;
        AppleEnableSwipeNavigateWithScrolls = true;
        "com.apple.swipescrolldirection" = true;
        "com.apple.trackpad.scaling" = 3.0;
      };
      onChange.activateSettings = true;
    };
  };
}
