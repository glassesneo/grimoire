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
      package = packageOption pkgs.alacritty;
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

    alacritty.settings = {};

    xdg.config.files = {
      "alacritty/alacritty.toml" = {
        exclusive = true;
        generator = (pkgs.formats.toml {}).generate "alacritty.toml";
        value = config.alacritty.settings;
      };
    };
  };
})
