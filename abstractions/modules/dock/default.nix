{delib, ...}:
delib.module {
  name = "dock";
  tests.fixture = ["defaults"];
  meta.description = "Configure the Dock and the actions of screen hot corners.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled.platform.darwin.defaults."com.apple.dock" = {
    settings = {
      autohide = true;
      autohide-delay = 1000.0;
      mouse-over-hilite-stack = true;
      orientation = "bottom";
      persistent-apps = [];
      persistent-others = [];
      show-recents = false;
      static-only = true;

      wvous-tl-corner = 1;
      wvous-tr-corner = 1;
      wvous-bl-corner = 1;
      wvous-br-corner = 13;
    };
    onChange.restartProcesses = ["Dock"];
  };
}
