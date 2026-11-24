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
  name = "alacritty";
  tests.fixture = ["exclusive"];
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
  }: let
    bundled = pkgs.runCommand cfg.package.name {} ''
      cp -a ${cfg.package} "$out"
      chmod -R u+w "$out"
      macos="$out/Applications/Alacritty.app/Contents/MacOS"
      if [ -L "$macos" ]; then
        rm "$macos"
        mkdir "$macos"
        cp "$out/bin/alacritty" "$macos/"
      fi
    '';
    package = myconfig.app-identity.stabilizeApp bundled;
  in {
    packages = [
      package
    ];

    files."Applications/Alacritty.app" = {
      exclusive = true;
      source = "${package}/Applications/Alacritty.app";
    };

    xdg.config.files = {
      "alacritty/alacritty.toml" = {
        exclusive = true;
        generator = (pkgs.formats.toml {}).generate "alacritty.toml";
        value = config.alacritty.settings;
      };
    };
  };
})
