{
  delib,
  lib,
  ...
}:
delib.module {
  name = "bat";
  tests.fixture = ["exclusive"];
  meta.description = "Provide and configure bat for file display.";

  options.enable = delib.boolOption true;

  hjem.always.options.bat.settings = lib.mkOption {
    type = lib.types.attrsOf (lib.types.either (lib.types.enum [true]) lib.types.str // {description = "true or string";});
    default = {};
    description = "Command-line options written to bat's configuration file, by long name without `--`; `true` writes an option without a value.";
  };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: {
    packages = [pkgs.bat];

    bat.settings = {
      style = "plain,changes";
      number = true;
    };

    # bat splits each line into arguments as a shell would.
    xdg.config.files."bat/config" = let
      option = name: value:
        if value == true
        then "--${name}"
        else "--${name}=${lib.escapeShellArg value}";
    in {
      exclusive = true;
      text = lib.concatLines (lib.mapAttrsToList option config.bat.settings);
    };
  };
}
