{
  delib,
  mylib,
  ...
}: let
  themes = mylib.schemeThemes {
    name = "vicinae";
    themes.rose-pine = "rose-pine";
  };
in
  delib.module ({myconfig, ...}: let
    inherit (myconfig.roles.colorscheme) resolved;
    theme = themes.of resolved;
  in {
    name = "vicinae.colorscheme";
    tests.fixture = ["roles.colorscheme" "vicinae"];
    meta = {
      description = "Give Vicinae the bundled theme of the held color scheme.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    constraints.ifEnabled = [(themes.constraint resolved)];

    hjem.ifEnabled.vicinae.settings.theme = {
      dark.name = theme;
      light.name = theme;
    };
  })
