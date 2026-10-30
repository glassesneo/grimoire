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
  name = "ghostty";
  meta = {
    description = "Provide Ghostty terminal emulator.";
    tags = ["gui"];
  };

  options = with delib; {
    enable = boolOption false;
    package = packageOption myconfig.casks.packages.ghostty {defaultText = lib.literalExpression "myconfig.casks.packages.ghostty";};
  };

  hjem.always = {pkgs, ...}: {
    options.ghostty.settings = lib.mkOption {
      inherit (pkgs.formats.keyValue {listsAsDuplicateKeys = true;}) type;
      default = {};
      description = "Settings written to the Ghostty configuration file; a list repeats its key once per element.";
    };
  };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: {
    packages = [
      cfg.package
    ];

    files."Applications/Ghostty.app" = {
      exclusive = true;
      source = "${cfg.package}/Applications/Ghostty.app";
    };

    ghostty.settings = {
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
      value = config.ghostty.settings;
    };
  };
})
