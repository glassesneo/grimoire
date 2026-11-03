{
  delib,
  lib,
  ...
}: let
  pipWidth = 840;
  pipHeight = 480;
  pipSize = pkgs:
    pkgs.runCommandCC "zoom-pip-size" {} ''
      mkdir -p "$out/bin"
      $CC -fobjc-arc -framework AppKit -o "$out/bin/zoom-pip-size" ${./pip-size.m}
    '';
in
  delib.module ({myconfig, ...}: {
    name = "zoom";
    meta.description = "Configure Accessibility Zoom: its mode, how it follows the pointer and focus, and the Picture-in-Picture window.";

    options.enable = delib.boolOption true;

    hjem.ifEnabled.platform.darwin.defaults."com.apple.universalaccess".settings = {
      closeViewScrollWheelModifiersInt = 1048576; # Specify Command key as the modifier
      closeViewScrollWheelToggle = true;
      closeViewZoomFollowsFocus = true;
      closeViewZoomMode = 1; # Picture-in-Picture
      closeViewPanningMode = 2; # Keep the pointer centered while zoomed in
    };

    # The PiP size is an archived NSValue, which Hjem user defaults cannot
    # declare. Activation runs as root, so the size is written as the user in
    # the user's bootstrap namespace, where the user's cfprefsd runs.
    # AXVisualSupportAgent caches the size and only rereads it on launch;
    # launchd relaunches it after it is terminated.
    darwin.ifEnabled = {pkgs, ...}: let
      user = lib.escapeShellArg myconfig.host.user.name;
      asUser = cmd: ''launchctl asuser "$(id -u -- ${user})" sudo --user=${user} -- ${cmd}'';
    in {
      system.activationScripts.extraActivation.text = lib.mkAfter ''
        echo "setting the Zoom Picture-in-Picture size..." >&2
        if [ "$(${asUser "${pipSize pkgs}/bin/zoom-pip-size ${toString pipWidth} ${toString pipHeight}"})" = changed ]; then
          ${asUser "/usr/bin/killall AXVisualSupportAgent"} >/dev/null 2>&1 || true
        fi
      '';
    };

    tests = {pkgs, ...}: {
      # Writing the size needs a user session, so the build only checks that
      # the program compiles and rejects an invalid size before touching it.
      pip-size = {
        protects = "zoom-pip-size compiles and rejects an invalid size before touching Zoom";
        platforms = lib.platforms.darwin;
        build = _:
          pkgs.runCommand "zoom-pip-size-usage" {} ''
            status=0
            ${pipSize pkgs}/bin/zoom-pip-size 0 1 2>/dev/null || status=$?
            test "$status" -eq 2
            touch "$out"
          '';
      };
    };
  })
