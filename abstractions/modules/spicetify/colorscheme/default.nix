{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: let
  inherit (myconfig.roles.colorscheme.resolved) palette;
  hex = lib.removePrefix "#";
in {
  name = "spicetify.colorscheme";
  tests.fixture = ["roles.colorscheme" "spicetify"];
  meta = {
    description = "Give Spotify colors from the held color scheme's palette.";
    follows = ["colorscheme"];
  };

  options.enable = delib.boolOption true;

  hjem.ifEnabled.programs.spicetify.customColorScheme = lib.mapAttrs (_: hex) {
    text = palette.foreground;
    subtext = palette.ansi.brightBlack;
    main = palette.background;
    main-elevated = palette.ansi.black;
    highlight = palette.ansi.black;
    highlight-elevated = palette.selectionBackground;
    sidebar = palette.background;
    player = palette.background;
    card = palette.selectionBackground;
    shadow = palette.background;
    selected-row = palette.foreground;
    button = palette.ansi.magenta;
    button-active = palette.ansi.brightMagenta;
    button-disabled = palette.ansi.brightBlack;
    tab-active = palette.selectionBackground;
    notification = palette.selectionBackground;
    notification-error = palette.ansi.red;
    misc = palette.ansi.brightBlack;
  };
})
