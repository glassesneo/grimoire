{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) rose-pine;

  # Official ports by scheme name: bat names a theme after its file.
  themes = mylib.schemeThemes {
    name = "bat";
    themes.rose-pine = {
      name = "rose-pine";
      source = _: "${rose-pine}/dist/rose-pine.tmTheme";
    };
  };

  # bat reads themes only from its compiled cache, which keeps the built-in
  # assets beside the theme; the cache records the bat that built it.
  cache = pkgs: theme:
    pkgs.runCommandLocal "bat-cache" {nativeBuildInputs = [pkgs.bat];} ''
      mkdir -p source/themes
      cp ${theme.source pkgs} source/themes/${theme.name}.tmTheme
      bat cache --build --source source --target "$out"
    '';
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    theme = themes.select cfg myconfig.colorscheme.resolved;
  in {
    name = "bat";
    tests.fixture = ["exclusive"];
    meta.description = "Provide and configure bat for file display.";

    options = with delib; {
      enable = boolOption true;
      useColorscheme = boolOption true "Whether bat takes its theme from `colorscheme.resolved`.";
    };

    constraints.ifEnabled = [(themes.constraint cfg myconfig.colorscheme.resolved)];

    hjem.ifEnabled = {pkgs, ...}: {
      packages = [pkgs.bat];

      environment.sessionVariables = lib.mkIf (theme != null) {
        BAT_CACHE_PATH = cache pkgs theme;
      };

      xdg.config.files."bat/config" = {
        exclusive = true;
        text =
          ''
            --style="plain,changes"
            --number
          ''
          + lib.optionalString (theme != null) ''
            --theme="${theme.name}"
          '';
      };
    };
  })
