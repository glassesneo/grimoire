{delib, ...}:
delib.module {
  name = "screenshots";
  meta.description = "Configure where screenshots are saved and in which format.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled.platform.darwin.defaults."com.apple.screencapture" = {
    settings = {
      location = "~/Desktop";
      type = "jpg";
    };
    onChange.restartProcesses = ["SystemUIServer"];
  };
}
