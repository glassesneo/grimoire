{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (lib) types;

  color = lib.mkOption {type = types.strMatching "#[0-9a-fA-F]{6}";};
  ansiNames = ["black" "red" "green" "yellow" "blue" "magenta" "cyan" "white" "brightBlack" "brightRed" "brightGreen" "brightYellow" "brightBlue" "brightMagenta" "brightCyan" "brightWhite"];

  # The contract between schemes and applications: terminal roles and the
  # sixteen ANSI colors.
  palette = types.submodule {
    options =
      lib.genAttrs ["background" "foreground" "cursor" "cursorText" "selectionBackground" "selectionForeground"] (_: color)
      // {ansi = lib.mkOption {type = types.submodule {options = lib.genAttrs ansiNames (_: color);};};};
  };

  scheme = types.submodule {
    options = {
      palette = lib.mkOption {
        type = types.nullOr palette;
        default = null;
        description = "Palette of a scheme without variants.";
      };
      default = lib.mkOption {
        type = types.nullOr types.str;
        default = null;
        description = "Variant used when a selection names none; set exactly when `variants` is.";
      };
      variants = lib.mkOption {
        type = types.attrsOf palette;
        default = {};
        description = "Palettes of a scheme with variants, by variant name.";
      };
    };
  };

  # Each file in schemes/ is the data of one scheme, named after the file.
  builtinSchemes =
    lib.mapAttrs' (file: _: lib.nameValuePair (lib.removeSuffix ".nix" file) (import (./schemes + "/${file}")))
    (lib.filterAttrs (file: type: type == "regular" && lib.hasSuffix ".nix" file) (builtins.readDir ./schemes));
in
  delib.module ({cfg, ...}: let
    schemeProblems = lib.concatLists (lib.mapAttrsToList (name: scheme:
      if scheme.variants == {}
      then
        lib.optional (scheme.palette == null) "colorscheme.schemes.${name} needs `palette` or `variants`"
        ++ lib.optional (scheme.default != null) "colorscheme.schemes.${name} sets `default` without `variants`"
      else
        lib.optional (scheme.palette != null) "colorscheme.schemes.${name} sets both `palette` and `variants`"
        ++ lib.optional (!(scheme.variants ? ${toString scheme.default})) "colorscheme.schemes.${name}.default must name one of its variants: ${lib.concatStringsSep ", " (builtins.attrNames scheme.variants)}")
    cfg.schemes);

    selection = cfg.selection;
    selected = cfg.schemes.${selection.name};
    selectionProblems =
      if selection == null
      then []
      else if !(cfg.schemes ? ${selection.name})
      then ["colorscheme.selection.name = \"${selection.name}\" is not a registered scheme: ${lib.concatStringsSep ", " (builtins.attrNames cfg.schemes)}"]
      else if selection.variant == null
      then []
      else if selected.variants == {}
      then ["colorscheme.selection.variant is set, but ${selection.name} has no variants"]
      else lib.optional (!(selected.variants ? ${selection.variant})) "colorscheme.selection.variant = \"${selection.variant}\" is not a variant of ${selection.name}: ${lib.concatStringsSep ", " (builtins.attrNames selected.variants)}";

    problems = schemeProblems ++ selectionProblems;

    resolve = name: variant: let
      scheme = cfg.schemes.${name};
      chosen =
        if variant == null
        then scheme.default
        else variant;
    in
      if scheme.variants == {}
      then {
        inherit name;
        variant = null;
        inherit (scheme) palette;
      }
      else {
        inherit name;
        variant = chosen;
        palette = scheme.variants.${chosen};
      };

    # Applications read these values; reading them with an invalid scheme or
    # selection fails with the same messages as the assertions.
    valid = value:
      if problems != []
      then throw "colorscheme: ${lib.concatStringsSep "; " problems}"
      else value;
  in {
    name = "colorscheme";
    meta.description = "Register color schemes and resolve the one selected for applications to share.";

    options = with delib; {
      schemes = attrsOfOption scheme {} "Registered schemes by name. A scheme has either a `palette` or `variants` with a `default`.";
      selection = mylib.atomicOption (lib.mkOption {
        type = types.nullOr (types.submodule {
          options = {
            name = strOption;
            variant = allowNull (strOption null) "Variant of the scheme; `null` uses the scheme's default.";
          };
        });
        default = null;
        description = "Scheme that applications share; `null` selects none. A higher source replaces it whole, so a variant always comes with its scheme's name.";
      });
      resolved = readOnly (defaultText (lib.mkOption {
        type = types.nullOr types.raw;
        default = valid (
          if selection == null
          then null
          else resolve selection.name selection.variant
        );
        description = "The selected scheme as `{ name, variant, palette }`, or `null` without a selection.";
      }) (lib.literalMD "the resolved `colorscheme.selection`"));
      combinations = readOnly (defaultText (lib.mkOption {
        type = types.attrsOf types.raw;
        default = valid (lib.concatMapAttrs (name: scheme:
          {${name} = resolve name null;}
          // lib.mapAttrs' (variant: _: lib.nameValuePair "${name}-${variant}" (resolve name variant)) scheme.variants)
        cfg.schemes);
        description = "Every scheme and variant, resolved like `resolved`, by name: `<scheme>` for a scheme's default and `<scheme>-<variant>` for each variant.";
      }) (lib.literalMD "every registered scheme and variant, resolved"));
    };

    myconfig.always.colorscheme.schemes = builtinSchemes;

    assertions.always = [
      {
        assertion = problems == [];
        message = lib.concatStringsSep "\n" problems;
      }
    ];

    checks = _: let
      variantScheme = {
        default = "dark";
        variants = {
          dark = builtinSchemes.rose-pine.palette;
          light = builtinSchemes.rose-pine.palette // {background = "#faf4ed";};
        };
      };
      resolved = result: result.options.myconfig.colorscheme.resolved.value;
      withFixture = attrs:
        {modules.fixture.myconfig.always.colorscheme.schemes.fixture = variantScheme;}
        // attrs;
    in {
      without-selection = {
        expr = resolved;
        expected = null;
      };
      scheme-without-variants = {
        host.myconfig.ifEnabled.colorscheme.selection.name = "rose-pine";
        expr = result: (resolved result).palette.background;
        expected = "#191724";
      };
      default-variant = withFixture {
        host.myconfig.ifEnabled.colorscheme.selection.name = "fixture";
        expr = result: {inherit (resolved result) name variant;};
        expected = {
          name = "fixture";
          variant = "dark";
        };
      };
      explicit-variant = withFixture {
        host.myconfig.ifEnabled.colorscheme.selection = {
          name = "fixture";
          variant = "light";
        };
        expr = result: (resolved result).palette.background;
        expected = "#faf4ed";
      };
      # A host naming only a scheme does not inherit a lower source's variant.
      replaced-selection = {
        modules.fixture.myconfig.always.colorscheme = {
          schemes.fixture = variantScheme;
          selection = {
            name = "fixture";
            variant = "light";
          };
        };
        host.myconfig.ifEnabled.colorscheme.selection.name = "fixture";
        expr = result: (resolved result).variant;
        expected = "dark";
      };
      combinations = withFixture {
        expr = result: lib.mapAttrs (_: combination: combination.variant) result.options.myconfig.colorscheme.combinations.value;
        expected = {
          fixture = "dark";
          fixture-dark = "dark";
          fixture-light = "light";
          rose-pine = null;
        };
      };
      unknown-scheme = {
        host.myconfig.ifEnabled.colorscheme.selection.name = "missing";
        fails = "\"missing\" is not a registered scheme";
      };
      unknown-variant = withFixture {
        host.myconfig.ifEnabled.colorscheme.selection = {
          name = "fixture";
          variant = "missing";
        };
        fails = "\"missing\" is not a variant of fixture";
      };
      variant-without-variants = {
        host.myconfig.ifEnabled.colorscheme.selection = {
          name = "rose-pine";
          variant = "main";
        };
        fails = "rose-pine has no variants";
      };
      missing-default = {
        modules.fixture.myconfig.always.colorscheme.schemes.fixture = variantScheme // {default = "missing";};
        fails = "colorscheme.schemes.fixture.default must name one of its variants";
      };
    };
  })
