{
  delib,
  lib,
  mylib,
  ...
}: let
  colorschemeTheme = import ../themes.nix {inherit lib;};
in
  delib.module ({myconfig, ...}: {
    name = "elio.colorscheme";
    tests.fixture = ["elio" "roles.colorscheme"];
    meta = {
      description = "Give elio a theme from the held color scheme's palette.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    myconfig.ifEnabled.elio.theme = colorschemeTheme myconfig.roles.colorscheme.resolved;

    tests.cases = {pkgs, ...}: {
      # A scheme without named colors for elio takes the ANSI theme.
      ansi-scheme = {
        protects = "a scheme without an elio theme maps to the ANSI theme";
        uses = ["colorscheme"];
        # Bundles evaluate `myconfig` without the Zsh features elio adds to.
        moduleSystem = "bundles";
        modules."colorscheme.fixture" = mylib.colorschemes.scheme {
          name = "fixture";
          description = "A scheme elio has no named theme for.";
          palette = let
            colors = lib.genAttrs ["black" "red" "green" "yellow" "blue" "magenta" "cyan" "white"] (_: "#000000");
          in {
            background = "#191724";
            foreground = "#e0def4";
            cursor = "#e0def4";
            cursorText = "#191724";
            selectionBackground = "#403d52";
            selectionForeground = "#e0def4";
            ansi = colors // lib.mapAttrs' (name: lib.nameValuePair "bright${lib.toUpper (lib.substring 0 1 name)}${lib.substring 1 (-1) name}") colors // {blue = "#9ccfd8";};
          };
        };
        host.myconfig.ifEnabled = {
          elio.package = pkgs.emptyDirectory;
          roles.colorscheme = {
            enable = true;
            holder = "colorscheme.fixture";
          };
        };
        expr = result: let
          theme = result.options.myconfig.elio.theme.value;
        in {
          bg = theme.palette.bg or null;
          directory = theme.classes.directory.color or null;
        };
        expected = {
          bg = "#191724";
          directory = "#9ccfd8";
        };
      };
    };
  })
