{
  delib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) rose-pine;

  themes = mylib.schemeThemes {
    name = "alacritty";
    themes.rose-pine = _: "${rose-pine}/dist/rose-pine.toml";
  };
in
  delib.module ({myconfig, ...}: let
    inherit (myconfig.roles.colorscheme) resolved;
  in {
    name = "alacritty.colorscheme";
    tests.fixture = ["alacritty" "roles.colorscheme"];
    meta = {
      description = "Give Alacritty the colors of the held color scheme.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    constraints.ifEnabled = [(themes.constraint resolved)];

    hjem.ifEnabled = {pkgs, ...}: {
      alacritty.settings.general.import = [(themes.of resolved pkgs)];
    };
  })
