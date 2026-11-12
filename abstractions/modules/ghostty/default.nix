{
  delib,
  lib,
  ...
}: let
  # Ghostty's palette indices, in order.
  ansiNames = ["black" "red" "green" "yellow" "blue" "magenta" "cyan" "white" "brightBlack" "brightRed" "brightGreen" "brightYellow" "brightBlue" "brightMagenta" "brightCyan" "brightWhite"];

  colorschemeSettings = palette: {
    inherit (palette) background foreground;
    cursor-color = palette.cursor;
    cursor-text = palette.cursorText;
    selection-background = palette.selectionBackground;
    selection-foreground = palette.selectionForeground;
    palette = lib.imap0 (index: name: "${toString index}=${palette.ansi.${name}}") ansiNames;
  };
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: {
    name = "ghostty";
    tests.fixture = ["defaults" "exclusive"];
    meta = {
      description = "Provide Ghostty terminal emulator.";
      tags = ["gui"];
    };

    options = {pkgs, ...}:
      with delib; {
        enable = boolOption false;
        package = packageOption myconfig.casks.packages.ghostty;
        useColorscheme = boolOption true "Whether Ghostty takes its colors from `colorscheme.resolved`.";
        settings = lib.mkOption {
          inherit (pkgs.formats.keyValue {listsAsDuplicateKeys = true;}) type;
          default = {};
          description = "Settings written to the Ghostty configuration file; a list repeats its key once per element.";
        };
      };

    myconfig.ifEnabled.ghostty.settings = lib.mkMerge [
      {
        keybind = [
          # Drops Ghostty's default keybindings before the ones below.
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
      (lib.mkIf (cfg.useColorscheme && myconfig.colorscheme.resolved != null)
        (colorschemeSettings myconfig.colorscheme.resolved.palette))
    ];

    hjem.ifEnabled = {pkgs, ...}: {
      packages = [
        cfg.package
      ];

      files."Applications/Ghostty.app" = {
        exclusive = true;
        source = "${cfg.package}/Applications/Ghostty.app";
      };

      # The Hide menu item takes Cmd+H before Ghostty can pass it to the
      # program; a zero-width space as its shortcut disables it.
      platform.darwin.defaults."com.mitchellh.ghostty".settings.NSUserKeyEquivalents."Hide Ghostty" = builtins.fromJSON ''"\u200b"'';

      xdg.config.files."ghostty/config.ghostty" = {
        exclusive = true;
        generator = (pkgs.formats.keyValue {
          listsAsDuplicateKeys = true;
          mkKeyValue = lib.generators.mkKeyValueDefault {} " = ";
        }).generate "config.ghostty";
        value = cfg.settings;
      };
    };
  })
