{
  delib,
  config,
  lib,
  mylib,
  ...
}: let
  # Schemes are the candidates of `roles.colorscheme`, found by metadata.
  schemes = lib.filter (name: config.modules.${name}.meta.role == "colorscheme") (builtins.attrNames config.modules);
in
  delib.module ({myconfig, ...}: {
    name = "colorscheme";
    meta.description = "Collect the combinations of every registered color scheme, for features that publish one per combination.";

    options.combinations = delib.readOnly (delib.defaultText (lib.mkOption {
      type = lib.types.attrsOf lib.types.raw;
      default = lib.concatMapAttrs (_: combinations: combinations) (lib.genAttrs schemes (scheme: lib.getAttrFromPath (lib.splitString "." scheme ++ ["combinations"]) myconfig));
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
        ansi = lib.genAttrs ["black" "red" "green" "yellow" "blue" "magenta" "cyan" "white" "brightBlack" "brightRed" "brightGreen" "brightYellow" "brightBlue" "brightMagenta" "brightCyan" "brightWhite"] (_: "#000000");
      };
    in {
      combinations = {
        protects = "combinations list every registered scheme's default and each of its variants";
        uses = ["roles.colorscheme"];
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
