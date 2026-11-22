# Rex is distributed only to invited beta testers and updates itself with
# Sparkle, so it is installed by hand at `rex.appPath` and never packaged;
# this module configures the installed app and runs the CLI bundled with it.
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
    lib.optional (cfg.font != null) {
      option = "rex.font";
      name = cfg.font;
    }
    ++ lib.imap0 (index: name: {
      option = "rex.fallbackFonts[${toString index}]";
      inherit name;
    }) (lib.optionals (cfg.fallbackFonts != null) cfg.fallbackFonts);
  referenceProblems = lib.filter (ref: !(myconfig.fonts.entries ? ${ref.name})) references;
  family = name: myconfig.fonts.entries.${name}.family;
in {
  name = "rex";
  tests.fixture = ["defaults" "exclusive" "fonts" "skills"];
  meta = {
    description = "Configure the hand-installed Rex terminal multiplexer and provide the CLI it bundles.";
    tags = ["gui"];
  };

  options = with delib; {
    enable = boolOption false;
    appPath = strOption "/Applications/Rex.app";
    font = allowNull (strOption null) "Name in fonts.entries; null leaves Rex's terminal font as set in the app.";
    fallbackFonts = allowNull (listOfOption lib.types.nonEmptyStr null) "Names in fonts.entries that Rex searches in order for characters missing from the terminal font; null leaves Rex's stored list unchanged.";
    fontSize = allowNull (numberOption null) "Terminal font size in points; null leaves Rex's stored size unchanged.";
    paddingX = allowNull (intOption null) "Horizontal terminal padding; null leaves Rex's stored value unchanged.";
    paddingY = allowNull (intOption null) "Vertical terminal padding; null leaves Rex's stored value unchanged.";
  };

  constraints.ifEnabled = [
    {
      assertion = references == [] || myconfig.fonts.enable;
      message = "rex.font and rex.fallbackFonts require fonts.enable = true when selecting registered fonts";
    }
    {
      assertion = referenceProblems == [];
      message = lib.concatMapStringsSep "\n" (ref: "${ref.option} = \"${ref.name}\" is not registered in fonts.entries") referenceProblems;
    }
  ];

  myconfig.ifEnabled.rex = {
    font = "maple-nf-jp";
    # Maple Mono NF JP covers Japanese itself; the empty list also clears a
    # list stored by an earlier apply.
    fallbackFonts = [];
  };

  hjem.ifEnabled = {pkgs, ...}: let
    cli = "${cfg.appPath}/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex";
    rex = pkgs.writeShellScriptBin "rex" ''
      if [[ ! -x ${lib.escapeShellArg cli} ]]; then
        echo "rex: Rex is not installed at ${cfg.appPath}" >&2
        exit 127
      fi
      exec ${lib.escapeShellArg cli} "$@"
    '';
    # Rex does not watch init.lua. Only a running server is reloaded: the
    # switch must not start one.
    apply = pkgs.writeShellScript "rex-apply" ''
      if [[ ! -x ${lib.escapeShellArg cli} ]]; then
        echo "warning: Rex is not installed at ${cfg.appPath}; install it from the Rex beta invitation. Its configuration is written anyway." >&2
        exit 0
      fi
      ${lib.escapeShellArg cli} --autostart=false config reload >/dev/null 2>&1 || true
    '';
  in {
    packages = [rex];

    applySteps.rex.package = pkgs.linkFarm "hjem-rex" {"bin/apply" = apply;};

    skills.rex = ./skill;

    xdg.config.files."rex/init.lua" = {
      exclusive = true;
      source = ./init.lua;
    };

    # Keys and values as Rex writes them for its settings; it reads them at
    # launch.
    platform.darwin.defaults."com.superlogical.rex".settings =
      {
        SUEnableAutomaticChecks = true;
        SUAutomaticallyUpdate = true;
        "Workspace.terminalOptionKeyBehavior" = "leftActsAsAlt";
        "Workspace.terminalCursorStyle" = "block";
        "Workspace.terminalCursorBlinkIntervalMilliseconds" = 0;
        "Workspace.terminalCursorBlinkUsesCustomInterval" = false;
        "Workspace.allowsTerminalNotifications" = true;
        "Workspace.focusFollowsMouse" = true;
        # Settings > Fade Inactive Panes > Content.
        "Workspace.inactivePaneFadeMode" = "text";
      }
      // lib.optionalAttrs (cfg.font != null && referenceProblems == []) {
        "Workspace.terminalFontName" = family cfg.font;
      }
      // lib.optionalAttrs (cfg.fallbackFonts != null && referenceProblems == []) {
        "Workspace.terminalFallbackFontNames" = map family cfg.fallbackFonts;
      }
      // lib.optionalAttrs (cfg.fontSize != null) {
        "Workspace.terminalFontPointSize" = cfg.fontSize;
      }
      // lib.optionalAttrs (cfg.paddingX != null) {
        "Workspace.terminalPaddingX" = cfg.paddingX;
      }
      // lib.optionalAttrs (cfg.paddingY != null) {
        "Workspace.terminalPaddingY" = cfg.paddingY;
      };
  };

  tests.cases = _: {
    unknown-font-is-rejected = {
      protects = "an enabled Rex cannot select a font missing from fonts.entries";
      host.myconfig.ifEnabled.rex = {
        enable = true;
        font = "missing-font";
      };
      fails = "rex.font = \"missing-font\" is not registered in fonts.entries";
    };
    unknown-fallback-font-is-rejected = {
      protects = "an enabled Rex cannot select a fallback font missing from fonts.entries";
      host.myconfig.ifEnabled.rex = {
        enable = true;
        fallbackFonts = ["miracode" "missing-fallback"];
      };
      fails = "rex.fallbackFonts[1] = \"missing-fallback\" is not registered in fonts.entries";
    };
    fallback-fonts-keep-order = {
      protects = "fallback fonts are written to Rex's defaults as their families, in declared order";
      host.myconfig.ifEnabled.rex = {
        enable = true;
        fallbackFonts = ["maple-nf-jp" "miracode"];
      };
      expr = result: result.options.platform.darwin.defaults.value."com.superlogical.rex".settings."Workspace.terminalFallbackFontNames";
      expected = ["Maple Mono NF JP" "Miracode"];
    };
  };
})
