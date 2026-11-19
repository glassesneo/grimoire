{
  delib,
  lib,
  mylib,
  ...
}:
delib.role ({
  cfg,
  myconfig,
  ...
}: {
  name = "colorscheme";
  meta.description = "Seat the color scheme that applications share.";

  # A candidate is a scheme declared with `mylib.colorschemes.scheme`.
  options.resolved = delib.readOnly (delib.defaultText (lib.mkOption {
    type = lib.types.raw;
    default = lib.getAttrFromPath (lib.splitString "." cfg.holder ++ ["resolved"]) myconfig;
    description = "The held scheme as `{ name, variant, palette }`; modules that read it declare `meta.follows = [\"colorscheme\"]`.";
  }) (lib.literalMD "the holder's `resolved`"));

  tests.cases = _: let
    palette = background: {
      inherit background;
      foreground = "#e0def4";
      cursor = "#e0def4";
      cursorText = "#191724";
      selectionBackground = "#403d52";
      selectionForeground = "#e0def4";
      ansi = lib.genAttrs ["black" "red" "green" "yellow" "blue" "magenta" "cyan" "white" "brightBlack" "brightRed" "brightGreen" "brightYellow" "brightBlue" "brightMagenta" "brightCyan" "brightWhite"] (_: "#000000");
    };
    holding = attrs:
      {
        modules."colorscheme.fixture" = mylib.colorschemes.scheme {
          name = "fixture";
          description = "A scheme with variants.";
          default = "dark";
          variants = {
            dark = palette "#191724";
            light = palette "#faf4ed";
          };
        };
        host.myconfig.ifEnabled.roles.colorscheme = {
          enable = true;
          holder = "colorscheme.fixture";
        };
        expr = result: let
          inherit (result.options.myconfig.roles.colorscheme.resolved.value) name variant palette;
        in {
          inherit name variant;
          inherit (palette) background;
        };
      }
      // attrs;
  in {
    default-variant = holding {
      protects = "a held scheme resolves to its default variant";
      expected = {
        name = "fixture";
        variant = "dark";
        background = "#191724";
      };
    };
    chosen-variant = holding {
      protects = "a held scheme resolves to the variant chosen for it";
      host.myconfig.ifEnabled = {
        roles.colorscheme = {
          enable = true;
          holder = "colorscheme.fixture";
        };
        colorscheme.fixture.variant = "light";
      };
      expected = {
        name = "fixture";
        variant = "light";
        background = "#faf4ed";
      };
    };
  };
})
