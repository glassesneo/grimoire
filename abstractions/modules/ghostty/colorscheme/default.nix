{
  delib,
  lib,
  ...
}: let
  # Ghostty's palette indices, in order.
  ansiNames = ["black" "red" "green" "yellow" "blue" "magenta" "cyan" "white" "brightBlack" "brightRed" "brightGreen" "brightYellow" "brightBlue" "brightMagenta" "brightCyan" "brightWhite"];
in
  delib.module ({myconfig, ...}: let
    inherit (myconfig.roles.colorscheme.resolved) palette;
  in {
    name = "ghostty.colorscheme";
    tests.fixture = ["ghostty" "roles.colorscheme"];
    meta = {
      description = "Give Ghostty the colors of the held color scheme's palette.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    myconfig.ifEnabled.ghostty.settings = {
      inherit (palette) background foreground;
      cursor-color = palette.cursor;
      cursor-text = palette.cursorText;
      selection-background = palette.selectionBackground;
      selection-foreground = palette.selectionForeground;
      palette = lib.imap0 (index: name: "${toString index}=${palette.ansi.${name}}") ansiNames;
    };
  })
