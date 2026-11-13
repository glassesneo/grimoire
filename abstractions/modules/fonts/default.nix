{
  delib,
  lib,
  ...
}: let
  entry = lib.types.submodule {
    options = {
      package = delib.packageOption;
      family = lib.mkOption {type = lib.types.nonEmptyStr;};
    };
  };
in
  delib.module ({cfg, ...}: {
    name = "fonts";
    meta.description = "Register font families for applications and install their packages as real files in the user's font directory.";
    tests.fixture = ["imprynt"];

    options = with delib; {
      enable = boolOption true;
      entries = attrsOfOption entry {} "Font families by reference name; every registered package is installed while fonts are enabled.";
      packages = readOnly (defaultText (listOfOption lib.types.package (lib.unique (map (font: font.package) (lib.attrValues cfg.entries)))) (lib.literalMD "the unique packages in `fonts.entries`"));
    };

    myconfig.always = {pkgs, ...}: {
      fonts.entries = {
        maple = {
          package = pkgs.maple-mono.truetype;
          family = "Maple Mono";
        };
        miracode = {
          package = pkgs.miracode;
          family = "Miracode";
        };
      };
    };

    # The empty declaration remains when disabled, so its next apply removes
    # the previous files rather than abandoning their journal.
    hjem.always = {
      config,
      pkgs,
      ...
    }: {
      imprynt.deployments.fonts = {
        root =
          if pkgs.stdenv.hostPlatform.isDarwin
          then "${config.directory}/Library/Fonts"
          else "${config.xdg.data.directory}/fonts";
        trees = lib.optionals cfg.enable (map (package: {
            source = "${package}/share/fonts";
            prefix = "imprynt/${lib.getName package}";
            extensions = [".ttf" ".otf" ".ttc" ".otc"];
          })
          cfg.packages);
      };
    };

    tests.cases = {
      pkgs,
      home,
      ...
    }: {
      shared-package-is-installed-once = {
        protects = "several registered families from one package produce a single installation tree";
        host.myconfig.ifEnabled.fonts.entries = {
          maple = {
            package = pkgs.emptyDirectory;
            family = "Fixture Regular";
          };
          miracode = {
            package = pkgs.emptyDirectory;
            family = "Fixture Alternate";
          };
        };
        expr = result: map (tree: tree.source) result.options.imprynt.deployments.value.fonts.trees;
        expected = ["${pkgs.emptyDirectory}/share/fonts"];
      };
      linux-uses-user-font-directory = {
        protects = "font deployment uses the user data font directory on Linux rather than a Darwin-only path";
        host.system = "aarch64-linux";
        expr = result: result.apply.steps.imprynt.deployments.fonts.root;
        expected = "${home}/.local/share/fonts";
      };
      disabling-retains-removal = {
        protects = "disabling fonts leaves its deployment registered with no files, so a later switch reconciles previous ownership";
        host.myconfig.ifEnabled.fonts.enable = false;
        build = result:
          pkgs.runCommand "fonts-disabled" {nativeBuildInputs = [pkgs.jq];} ''
            jq -e '.version == 1 and (.files | length == 0)' ${result.apply.steps.imprynt.deployments.fonts.manifest}
            touch "$out"
          '';
      };
    };
  })
