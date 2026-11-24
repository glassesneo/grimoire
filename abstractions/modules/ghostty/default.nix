{
  delib,
  lib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: let
  references =
    lib.optional (cfg.font.primary != null) {
      option = "ghostty.font.primary";
      name = cfg.font.primary;
    }
    ++ lib.imap0 (index: name: {
      option = "ghostty.font.fallbacks[${toString index}]";
      inherit name;
    })
    cfg.font.fallbacks
    ++ lib.imap0 (index: mapping: {
      option = "ghostty.font.codepointMap[${toString index}].font";
      name = mapping.font;
    })
    cfg.font.codepointMap;
  referenceProblems = lib.filter (ref: !(myconfig.fonts.entries ? ${ref.name})) references;
  resolve = name:
    if myconfig.fonts.entries ? ${name}
    then myconfig.fonts.entries.${name}.family
    else throw "ghostty: unknown font `${name}`; register it with fonts.entries";
  fontSettings =
    lib.optionalAttrs (cfg.font.primary != null) {font-family = map resolve ([cfg.font.primary] ++ cfg.font.fallbacks);}
    // lib.optionalAttrs (cfg.font.codepointMap != []) {
      font-codepoint-map = map (mapping: "${lib.concatStringsSep "," mapping.ranges}=${resolve mapping.font}") cfg.font.codepointMap;
    };
in {
  name = "ghostty";
  tests.fixture = ["defaults" "exclusive" "fonts"];
  meta = {
    description = "Provide Ghostty terminal emulator.";
    tags = ["gui"];
  };

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption false;
      package = packageOption myconfig.casks.packages.ghostty;
      font = {
        primary = allowNull (strOption null) "Name in fonts.entries; null leaves Ghostty's primary font at its own default.";
        fallbacks = listOfOption lib.types.nonEmptyStr [] "Names in fonts.entries that Ghostty searches in order for characters missing from the primary font.";
        codepointMap = listOfOption (lib.types.submodule {
          options = {
            ranges = lib.mkOption {
              type = lib.types.nonEmptyListOf lib.types.nonEmptyStr;
              description = "Ghostty codepoint ranges such as U+0030-U+0039, joined with commas for one mapping.";
            };
            font = lib.mkOption {
              type = lib.types.nonEmptyStr;
              description = "Name in fonts.entries.";
            };
          };
        }) [];
      };
      settings = lib.mkOption {
        inherit (pkgs.formats.keyValue {listsAsDuplicateKeys = true;}) type;
        default = {};
        description = "Settings written to the Ghostty configuration file; a list repeats its key once per element. Use ghostty.font for font-family and font-codepoint-map.";
      };
    };

  constraints.ifEnabled = [
    {
      assertion = references == [] || myconfig.fonts.enable;
      message = "ghostty.font requires fonts.enable = true when selecting registered fonts";
    }
    {
      assertion = cfg.font.fallbacks == [] || cfg.font.primary != null;
      message = "ghostty.font.fallbacks requires ghostty.font.primary to be set";
    }
    {
      assertion = referenceProblems == [];
      message = lib.concatMapStringsSep "\n" (ref: "${ref.option} = \"${ref.name}\" is not registered in fonts.entries") referenceProblems;
    }
    {
      assertion = !(cfg.settings ? font-family) && !(cfg.settings ? font-codepoint-map);
      message = "ghostty.settings.font-family and font-codepoint-map must be set through ghostty.font.primary and ghostty.font.codepointMap";
    }
  ];

  myconfig.ifEnabled.ghostty.font = {
    primary = "maple-nf-jp";
    codepointMap = [
      {
        ranges = ["U+0030-U+0039"];
        font = "miracode";
      }
      {
        ranges = ["U+002A-U+002B" "U+002F" "U+003C-U+003E" "U+007C"];
        font = "miracode";
      }
    ];
  };

  myconfig.ifEnabled.ghostty.settings = lib.mkMerge [
    {
      keybind = [
        "clear"
        "cmd+shift+,=reload_config"
        "cmd+c=copy_to_clipboard"
        "cmd+shift+c=copy_url_to_clipboard"
        "cmd+v=paste_from_clipboard"
        "cmd+shift+p=toggle_command_palette"
      ];
      auto-update = "off";
      font-feature = "-dlig";
      desktop-notifications = true;
      window-inherit-working-directory = false;
      macos-titlebar-style = "hidden";
      macos-option-as-alt = "left";
      cursor-style-blink = false;
      shell-integration-features = "no-cursor";
    }
  ];

  tests.cases = {pkgs, ...}: let
    withGhostty = attrs:
      lib.recursiveUpdate {
        host.myconfig.ifEnabled.ghostty = {
          enable = true;
          package = pkgs.emptyDirectory;
        };
      }
      attrs;
    fixtureFonts =
      lib.mapAttrs (_: family: {
        package = pkgs.emptyDirectory;
        inherit family;
      }) {
        fixture-primary = "Fixture Primary";
        fixture-first = "Fixture First";
        fixture-second = "Fixture Second";
      };
  in {
    unknown-primary-is-rejected = withGhostty {
      protects = "an enabled Ghostty cannot select an unregistered primary font";
      host.myconfig.ifEnabled.ghostty.font.primary = "missing-primary";
      expr = result: result.options.xdg.config.files.value."ghostty/config.ghostty".value;
      fails = true;
    };
    unknown-mapped-font-is-rejected = withGhostty {
      protects = "every codepoint mapping is checked against the font registry, not only the primary font";
      host.myconfig.ifEnabled.ghostty.font.codepointMap = [
        {
          ranges = ["U+0030-U+0039"];
          font = "miracode";
        }
        {
          ranges = ["U+0041"];
          font = "missing-mapped";
        }
      ];
      expr = result: result.options.xdg.config.files.value."ghostty/config.ghostty".value;
      fails = true;
    };
    unknown-fallback-is-rejected = withGhostty {
      protects = "fallback fonts are checked against the font registry";
      host.myconfig.ifEnabled.ghostty.font.fallbacks = ["miracode" "missing-fallback"];
      expr = result: result.options.xdg.config.files.value."ghostty/config.ghostty".value;
      fails = true;
    };
    fallbacks-follow-primary = withGhostty {
      protects = "fallback fonts are written as font-family entries after the primary font, in declared order, resolved to their families";
      host.myconfig.ifEnabled = {
        fonts.entries = fixtureFonts;
        ghostty.font = {
          primary = "fixture-primary";
          fallbacks = ["fixture-second" "fixture-first"];
        };
      };
      expr = result: result.options.xdg.config.files.value."ghostty/config.ghostty".value.font-family;
      expected = ["Fixture Primary" "Fixture Second" "Fixture First"];
    };
    mappings-without-primary = withGhostty {
      protects = "codepoint-only font selection preserves mapping order and resolves each family without setting a primary font";
      host.myconfig.ifEnabled.ghostty.font = {
        primary = null;
        codepointMap = [
          {
            ranges = ["U+0030" "U+0032"];
            font = "miracode";
          }
          {
            ranges = ["U+0041-U+005A"];
            font = "maple-nf-jp";
          }
        ];
      };
      expr = result: let
        settings = result.options.xdg.config.files.value."ghostty/config.ghostty".value;
      in {
        primary = settings ? font-family;
        mappings = settings.font-codepoint-map;
      };
      expected = {
        primary = false;
        mappings = ["U+0030,U+0032=Miracode" "U+0041-U+005A=Maple Mono NF JP"];
      };
    };
  };

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [
      cfg.package
    ];

    files."Applications/Ghostty.app" = {
      exclusive = true;
      source = "${cfg.package}/Applications/Ghostty.app";
    };

    # The Hide menu item takes Cmd+H before Ghostty sees it; a zero-width space
    # as its shortcut disables it.
    platform.darwin.defaults."com.mitchellh.ghostty".settings.NSUserKeyEquivalents."Hide Ghostty" = builtins.fromJSON ''"\u200b"'';

    xdg.config.files."ghostty/config.ghostty" = {
      exclusive = true;
      generator = (pkgs.formats.keyValue {
        listsAsDuplicateKeys = true;
        mkKeyValue = lib.generators.mkKeyValueDefault {} " = ";
      }).generate "config.ghostty";
      value = cfg.settings // fontSettings;
    };
  };
})
