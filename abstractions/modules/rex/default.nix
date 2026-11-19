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
}: {
  name = "rex";
  tests.fixture = ["defaults" "exclusive" "fonts" "skills"];
  meta = {
    description = "Configure the hand-installed Rex terminal multiplexer and provide the CLI it bundles.";
    tags = ["gui"];
  };

  options = with delib; {
    enable = boolOption false;
    appPath = strOption "/Applications/Rex Beta.app";
    font = allowNull (strOption null) "Name in fonts.entries; null leaves Rex's terminal font as set in the app.";
    fontSize = allowNull (numberOption null) "Terminal font size in points; null leaves Rex's stored size unchanged.";
    paddingX = allowNull (intOption null) "Horizontal terminal padding; null leaves Rex's stored value unchanged.";
    paddingY = allowNull (intOption null) "Vertical terminal padding; null leaves Rex's stored value unchanged.";
  };

  constraints.ifEnabled = [
    {
      assertion = cfg.font == null || myconfig.fonts.enable;
      message = "rex.font requires fonts.enable = true";
    }
    {
      assertion = cfg.font == null || myconfig.fonts.entries ? ${cfg.font};
      message = "rex.font = \"${toString cfg.font}\" is not registered in fonts.entries";
    }
  ];

  myconfig.ifEnabled.rex.font = "maple";

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
      // lib.optionalAttrs (cfg.font != null && myconfig.fonts.entries ? ${cfg.font}) {
        "Workspace.terminalFontName" = myconfig.fonts.entries.${cfg.font}.family;
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
  };
})
