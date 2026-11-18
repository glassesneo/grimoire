# Rex is distributed only to invited beta testers and updates itself with
# Sparkle, so it is installed by hand at `rex.appPath` and never packaged;
# this module configures the installed app and runs the CLI bundled with it.
{
  delib,
  lib,
  ...
}: let
  # The palette indices of Ghostty's theme format, which Rex imports.
  ansiNames = ["black" "red" "green" "yellow" "blue" "magenta" "cyan" "white" "brightBlack" "brightRed" "brightGreen" "brightYellow" "brightBlue" "brightMagenta" "brightCyan" "brightWhite"];
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    resolved = myconfig.colorscheme.resolved;
    theme = lib.optionalAttrs (cfg.useColorscheme && resolved != null) {
      name = lib.concatStringsSep " " (lib.filter (part: part != null) [resolved.name resolved.variant]);
      text = let
        inherit (resolved) palette;
      in
        lib.concatLines ([
            "background = ${palette.background}"
            "foreground = ${palette.foreground}"
            "cursor-color = ${palette.cursor}"
            "cursor-text = ${palette.cursorText}"
            "selection-background = ${palette.selectionBackground}"
            "selection-foreground = ${palette.selectionForeground}"
          ]
          ++ lib.imap0 (index: name: "palette = ${toString index}=${palette.ansi.${name}}") ansiNames);
    };
  in {
    name = "rex";
    tests.fixture = ["defaults" "exclusive" "fonts" "skills"];
    meta = {
      description = "Configure the hand-installed Rex terminal multiplexer and provide the CLI it bundles.";
      tags = ["gui"];
    };

    options = with delib; {
      enable = boolOption false;
      appPath = strOption "/Applications/Rex Beta.app";
      useColorscheme = boolOption true "Whether Rex's dark theme is generated from `colorscheme.resolved`; Rex selects it only once `rex-import-theme` runs.";
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

    hjem.ifEnabled = {
      config,
      pkgs,
      ...
    }: let
      cli = "${cfg.appPath}/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex";
      rex = pkgs.writeShellScriptBin "rex" ''
        if [[ ! -x ${lib.escapeShellArg cli} ]]; then
          echo "rex: Rex is not installed at ${cfg.appPath}" >&2
          exit 127
        fi
        exec ${lib.escapeShellArg cli} "$@"
      '';
      themeFile = "${config.xdg.config.directory}/rex/themes/${theme.name}";
      # Rex keeps imported themes inside its preferences and accepts these
      # actions only while Remote Control is on, so this runs by hand.
      importTheme = pkgs.writeShellScriptBin "rex-import-theme" ''
        set -e
        ${lib.getExe rex} do client.theme.import path=${lib.escapeShellArg themeFile}
        ${lib.getExe rex} do client.setting.themes.dark.palette value=${lib.escapeShellArg theme.name}
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
      packages = [rex] ++ lib.optional (theme != {}) importTheme;

      applySteps.rex.package = pkgs.linkFarm "hjem-rex" {"bin/apply" = apply;};

      skills.rex = ./skill;

      xdg.config.files =
        {
          "rex/init.lua" = {
            exclusive = true;
            source = ./init.lua;
          };
        }
        // lib.optionalAttrs (theme != {}) {
          "rex/themes/${theme.name}" = {
            exclusive = true;
            inherit (theme) text;
          };
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
          useColorscheme = false;
          font = "missing-font";
        };
        fails = "rex.font = \"missing-font\" is not registered in fonts.entries";
      };
    };
  })
