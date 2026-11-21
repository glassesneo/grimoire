{
  delib,
  lib,
  mylib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "colorscheme";
  tests.fixture = ["roles.colorscheme"];
  meta.description = "Collect the combinations of every registered color scheme, for features that publish one per combination.";

  options.combinations = delib.readOnly (delib.defaultText (lib.mkOption {
    type = lib.types.attrsOf lib.types.raw;
    # Schemes are the candidates of `roles.colorscheme`.
    default = lib.mergeAttrsList (map (scheme: delib.getAttrByStrPath myconfig "${scheme}.combinations" {}) myconfig.roles.colorscheme.candidates);
    description = "Every scheme and variant, resolved as `roles.colorscheme.resolved` is, by name: `<scheme>` for a scheme's default and `<scheme>-<variant>` for each variant.";
  }) (lib.literalMD "every registered scheme's `combinations`"));

  tests.cases = _: let
    palette = {
      background = "#191724";
      foreground = "#e0def4";
      cursor = "#e0def4";
      cursorText = "#191724";
      selectionBackground = "#403d52";
      selectionForeground = "#e0def4";
      ansi = lib.genAttrs mylib.colorschemes.ansiNames (_: "#000000");
    };
  in {
    combinations = {
      protects = "combinations list every registered scheme's default and each of its variants";
      modules = {
        "colorscheme.plain" = mylib.colorschemes.scheme {
          name = "plain";
          description = "A scheme without variants.";
          inherit palette;
        };
        "colorscheme.varied" = mylib.colorschemes.scheme {
          name = "varied";
          description = "A scheme with variants.";
          default = "dark";
          variants = {
            dark = palette;
            light = palette;
          };
        };
      };
      expr = result: lib.mapAttrs (_: combination: combination.variant) result.options.myconfig.colorscheme.combinations.value;
      expected = {
        plain = null;
        varied = "dark";
        varied-dark = "dark";
        varied-light = "light";
      };
    };
  };
})
