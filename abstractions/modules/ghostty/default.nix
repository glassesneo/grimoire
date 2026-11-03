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

    tests = {pkgs, ...}: let
      host = extra: {
        uses = ["colorscheme"];
        host.myconfig.ifEnabled =
          lib.recursiveUpdate {
            ghostty = {
              enable = true;
              package = pkgs.emptyDirectory;
            };
            colorscheme.selection.name = "rose-pine";
          }
          extra;
        expr = result: let
          settings = result.options.myconfig.ghostty.settings.value;
        in {
          background = settings.background or null;
          palette = builtins.head (settings.palette or [null]);
          keybind = builtins.length settings.keybind > 0;
        };
      };
    in {
      colorscheme =
        host {}
        // {
          expected = {
            background = ["#191724"];
            palette = "0=#26233a";
            keybind = true;
          };
        };
      explicit-color =
        host {ghostty.settings.background = "#000000";}
        // {
          expected = {
            background = ["#000000"];
            palette = "0=#26233a";
            keybind = true;
          };
        };
      without-colorscheme =
        host {ghostty.useColorscheme = false;}
        // {
          expected = {
            background = null;
            palette = null;
            keybind = true;
          };
        };
    };
  })
