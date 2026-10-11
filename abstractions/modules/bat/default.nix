{delib, ...}:
delib.module {
  name = "bat";
  meta.description = "Provide and configure bat for file display.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.bat];

    xdg.config.files."bat/config" = {
      exclusive = true;
      text = ''
        --style="plain,changes"
        --number
      '';
    };
  };
}
