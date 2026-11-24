{
  lib,
  documented,
}: let
  inherit (lib) types;

  colorType = types.strMatching "#[0-9a-fA-F]{6}";
  color = lib.mkOption {type = colorType;};
  ansiNames = ["black" "red" "green" "yellow" "blue" "magenta" "cyan" "white" "brightBlack" "brightRed" "brightGreen" "brightYellow" "brightBlue" "brightMagenta" "brightCyan" "brightWhite"];

  paletteType = types.submodule {
    options =
      lib.genAttrs ["background" "foreground" "cursor" "cursorText" "selectionBackground" "selectionForeground"] (_: color)
      // {
        ansi = lib.mkOption {type = types.submodule {options = lib.genAttrs ansiNames (_: color);};};
        named = lib.mkOption {
          type = types.attrsOf colorType;
          default = {};
          description = "Colors under the names the scheme itself gives them.";
        };
      };
  };

  readOnly = type: default: description:
    lib.mkOption {
      inherit type default description;
      readOnly = true;
    };
in {
  palette =
    documented {
      description = "The palette shared by schemes and applications: the terminal roles `background`, `foreground`, `cursor`, `cursorText`, `selectionBackground` and `selectionForeground`, the sixteen ANSI colors under `ansi`, named as `ansiNames` lists them in terminal index order, and the scheme's own vocabulary under `named`, which only scheme-specific mappings read.";
    }
    paletteType;
  inherit ansiNames;

  ghosttyTheme =
    documented {
      description = "A palette as the keys of Ghostty's theme format, which Rex also imports.";
      arguments.palette = "A value of `palette`.";
    } (palette: {
      inherit (palette) background foreground;
      cursor-color = palette.cursor;
      cursor-text = palette.cursorText;
      selection-background = palette.selectionBackground;
      selection-foreground = palette.selectionForeground;
      palette = lib.imap0 (index: name: "${toString index}=${palette.ansi.${name}}") ansiNames;
    });

  scheme =
    documented {
      description = "A `delib.module` declaration for `colorscheme.<name>`, a candidate of `roles.colorscheme` that is always registered. A scheme has either a `palette` or `variants` with a `default`; with variants, the module's `variant` chooses one. The module's `resolved` is the chosen palette as `{ name, variant, palette }`, and `combinations` every variant resolved by name: `<name>` for the default and `<name>-<variant>` for each variant.";
      arguments = {
        name = "The scheme's name.";
        description = "The module's `meta.description`.";
        palette = "The palette of a scheme without variants.";
        variants = "Palettes by variant name.";
        default = "The variant chosen unless the module's `variant` says otherwise.";
      };
    } ({
      name,
      description,
      palette ? null,
      variants ? {},
      default ? null,
    }:
      if (palette == null) == (variants == {})
      then throw "colorscheme ${name}: declare either `palette` or `variants`"
      else if (variants == {}) != (default == null)
      then throw "colorscheme ${name}: `default` names one of `variants` and is set only with them"
      else if variants != {} && !(variants ? ${default})
      then throw "colorscheme ${name}: `default = \"${default}\"` is not one of its variants: ${lib.concatStringsSep ", " (builtins.attrNames variants)}"
      else
        {cfg, ...}: let
          resolve = variant: {
            inherit name variant;
            palette =
              if variant == null
              then cfg.palette
              else cfg.variants.${variant};
          };
        in {
          name = "colorscheme.${name}";
          meta = {
            inherit description;
            role = "colorscheme";
          };
          tests.fixture = ["roles.colorscheme"];

          options =
            {
              resolved = readOnly types.raw (resolve (cfg.variant or null)) "The scheme as `{ name, variant, palette }`, with the chosen variant.";
              combinations =
                readOnly (types.attrsOf types.raw) (
                  {${name} = resolve default;}
                  // lib.mapAttrs' (variant: _: lib.nameValuePair "${name}-${variant}" (resolve variant)) variants
                )
                "Every variant resolved like `resolved`, by name: `${name}` for the default and `${name}-<variant>` for each variant.";
            }
            // (
              if variants == {}
              then {palette = readOnly paletteType palette "Palette of the scheme.";}
              else {
                variants = readOnly (types.attrsOf paletteType) variants "Palettes of the scheme by variant name.";
                variant = lib.mkOption {
                  type = types.enum (builtins.attrNames variants);
                  inherit default;
                  description = "Variant that `resolved` follows.";
                };
              }
            );
        });
}
