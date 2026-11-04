{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) rose-pine;

  # Official ports by scheme name, imported by the configuration file.
  themes = mylib.schemeThemes {
    name = "alacritty";
    themes.rose-pine = _: "${rose-pine}/dist/rose-pine.toml";
  };
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    theme = themes.select cfg myconfig.colorscheme.resolved;
  in {
    name = "alacritty";
    meta = {
      description = "Provide Alacritty terminal emulator.";
      tags = ["gui"];
    };

    options = {pkgs, ...}:
      with delib; {
        enable = boolOption false;
        package = packageOption pkgs.alacritty;
        useColorscheme = boolOption true "Whether Alacritty takes its colors from `colorscheme.resolved`.";
      };

    constraints.ifEnabled = [(themes.constraint cfg myconfig.colorscheme.resolved)];

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
      # stabilizeApp links bin/alacritty into the bundle, which loops through the
      # nixpkgs bundle's Contents/MacOS symlink to bin, so the directory is made
      # real first.
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
      # nixpkgs builds Alacritty ad-hoc signed, so its TCC grants would follow
      # the cdhash and lapse on every rebuild.
      package = myconfig.app-identity.stabilizeApp bundled;
    in {
      packages = [
        package
      ];

      files."Applications/Alacritty.app" = {
        exclusive = true;
        source = "${package}/Applications/Alacritty.app";
      };

      alacritty.settings.general.import = lib.mkIf (theme != null) [(theme pkgs)];

      xdg.config.files = {
        "alacritty/alacritty.toml" = {
          exclusive = true;
          generator = (pkgs.formats.toml {}).generate "alacritty.toml";
          value = config.alacritty.settings;
        };
      };
    };
  })
