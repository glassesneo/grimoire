{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "alacritty";
  meta = {
    description = "Provide Alacritty terminal emulator.";
    tags = ["gui"];
  };

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption false;
      package = packageOption pkgs.alacritty {defaultText = lib.literalExpression "pkgs.alacritty";};
    };

  hjem.always = {pkgs, ...}: {
    options.alacritty.settings = lib.mkOption {
      inherit (pkgs.formats.toml {}) type;
      default = {};
      description = "Settings written to the alacritty configuration file.";
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

    files."Applications/Alacritty.app" = {
      exclusive = true;
      source = "${cfg.package}/Applications/Alacritty.app";
    };

    alacritty.settings.keyboard.bindings = let
      # Alacritty cannot drop its default key bindings at once. A binding
      # without a mode replaces every default with the same key and
      # modifiers, so one per pair of alacritty-bindings(5) of Alacritty
      # 0.17, except those kept below, removes them all.
      defaults = let
        withMods = mods: map (key: {inherit key mods;});
      in
        map (key: {inherit key;}) ["Paste" "Copy"]
        ++ withMods "Control" ["L"]
        ++ withMods "Shift" ["PageUp" "PageDown" "Home" "End"]
        ++ withMods "Command" ["K" "0" "=" "+" "NumpadAdd" "-" "NumpadSubtract" "H" "M" "Q" "W" "N" "T" "F" "B" "Tab" "1" "2" "3" "4" "5" "6" "7" "8" "9"]
        ++ withMods "Command|Shift" ["]" "[" "Tab"]
        ++ withMods "Command|Alt" ["H"]
        ++ withMods "Command|Control" ["F"];
    in
      map (binding: binding // {action = "ReceiveChar";}) defaults
      ++ [
        {
          key = "C";
          mods = "Command";
          action = "Copy";
        }
        {
          key = "V";
          mods = "Command";
          action = "Paste";
        }
      ];

    # The Hide menu item takes Cmd+H before Alacritty can pass it to the
    # program; a zero-width space as its shortcut disables it. winit titles
    # the item with the process name.
    platform.darwin.defaults."org.alacritty".settings.NSUserKeyEquivalents."Hide alacritty" = builtins.fromJSON ''"\u200b"'';

    xdg.config.files = {
      "alacritty/alacritty.toml" = {
        exclusive = true;
        generator = (pkgs.formats.toml {}).generate "alacritty.toml";
        value = config.alacritty.settings;
      };
    };
  };
})
