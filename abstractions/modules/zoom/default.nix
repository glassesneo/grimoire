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
      closeViewScrollWheelModifiersInt = 1048576;
      closeViewScrollWheelToggle = true;
      closeViewZoomFollowsFocus = true;
      closeViewZoomMode = 1;
      closeViewPanningMode = 2;
    };

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

    tests.fixture = ["defaults"];

    tests.cases = {pkgs, ...}: {
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
