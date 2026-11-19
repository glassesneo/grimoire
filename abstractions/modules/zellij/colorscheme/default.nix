{
  delib,
  mylib,
  ...
}: let
  themes = import ../themes.nix {inherit mylib;};
in
  delib.module ({myconfig, ...}: let
    inherit (myconfig.roles.colorscheme) resolved;
    theme = themes.of resolved;
  in {
    name = "zellij.colorscheme";
    tests.fixture = ["exclusive" "roles.colorscheme" "zellij"];
    meta = {
      description = "Give Zellij the official theme of the held color scheme.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    constraints.ifEnabled = [(themes.constraint resolved)];

    myconfig.ifEnabled.zellij.settings.theme = theme.name;

    hjem.ifEnabled = {pkgs, ...}: {
      xdg.config.files."zellij/themes/${theme.name}.kdl" = {
        exclusive = true;
        source = theme.source pkgs;
      };
    };
  })
