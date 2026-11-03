{
  delib,
  lib,
  mylib,
  ...
}: let
  # Official ports by scheme name, imported by the configuration file.
  themes = mylib.schemeThemes {
    name = "alacritty";
    themes.rose-pine = pkgs: "${pkgs.fetchFromGitHub {
      owner = "rose-pine";
      repo = "alacritty";
      rev = "a6f7c8245e5bba639befe52e1e025f84ba8b3ee5";
      hash = "sha256-eVQjH5TrMLP9FdxIovnH9ulxTr6uw82Dt8PGGvpF94k=";
    }}/dist/rose-pine.toml";
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

    assertions.ifEnabled = [(themes.assertion cfg myconfig.colorscheme.resolved)];

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

    checks = {pkgs, ...}: let
      host = extra: {
        uses = ["app-identity" "colorscheme"];
        host.myconfig.ifEnabled =
          lib.recursiveUpdate {
            alacritty.enable = true;
            colorscheme.selection.name = "rose-pine";
          }
          extra;
      };
      imports = result: result.options.alacritty.settings.value.general.import or [];
    in {
      # The configuration imports the official colors.
      colorscheme =
        host {}
        // {
          build = result:
            pkgs.runCommand "alacritty-colorscheme" {imported = imports result;} ''
              grep -A2 -Fx '[colors.primary]' $imported | grep -Fx 'background = "#191724"'
              touch "$out"
            '';
        };
      unsupported-scheme = lib.recursiveUpdate (host {}) themes.unsupportedCase;
      without-colorscheme =
        host {alacritty.useColorscheme = false;}
        // {
          expr = imports;
          expected = [];
        };
    };
  })
