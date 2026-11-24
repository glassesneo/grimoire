{
  delib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) rose-pine;

  themes = mylib.schemeThemes {
    name = "bat";
    themes.rose-pine = {
      name = "rose-pine";
      source = _: "${rose-pine}/dist/rose-pine.tmTheme";
    };
  };

  cache = pkgs: theme:
    pkgs.runCommandLocal "bat-cache" {nativeBuildInputs = [pkgs.bat];} ''
      mkdir -p source/themes
      cp ${theme.source pkgs} source/themes/${theme.name}.tmTheme
      bat cache --build --source source --target "$out"
    '';
in
  delib.module ({myconfig, ...}: let
    inherit (myconfig.roles.colorscheme) resolved;
    theme = themes.of resolved;
  in {
    name = "bat.colorscheme";
    tests.fixture = ["bat" "roles.colorscheme"];
    meta = {
      description = "Give bat the theme of the held color scheme.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    constraints.ifEnabled = [(themes.constraint resolved)];

    hjem.ifEnabled = {pkgs, ...}: {
      bat.settings.theme = theme.name;
      environment.sessionVariables.BAT_CACHE_PATH = cache pkgs theme;
    };
  })
