{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.flakes ./anchors.json) mnw neovim-nightly-overlay;

  themes = import ./themes.nix {inherit lib mylib;};
in
  delib.module ({
    cfg,
    opt,
    myconfig,
    ...
  }: let
    mkPackage = pkgs: resolved: let
      base = opt.settings.valueMeta.configuration;
      final =
        if resolved == null
        then base
        else
          base.extendModules {
            modules = [(mylib.sources.prioritize mylib.sources.priorities.module base.options (themes.of resolved pkgs resolved))];
          };
      failedAssertions = mylib.assertions.failed final.config.assertions;
    in
      if failedAssertions != []
      then throw "\nFailed mnw assertions:\n${lib.concatMapStrings (message: "- ${message}\n") failedAssertions}"
      else lib.showWarnings final.config.warnings (mnw.lib.uncheckedWrap pkgs final.config);
  in {
    name = "neovim";
    meta = {
      description = "Provide and configure neovim";
      role = "editor";
    };

    options = {pkgs, ...}:
      with delib; {
        enable = boolOption true;
        snacks = lib.mkOption {
          type = lib.types.attrsOf (pkgs.formats.json {}).type;
          default = {};
          description = "Snacks setup options contributed by features; the parent installs and configures the shared plugin once.";
        };
        snacksDependencies = mylib.accumulatingOption (lib.mkOption {
          type = lib.types.listOf lib.types.package;
          default = [];
          description = "Plugin dependencies requested by Snacks features; the shared Snacks package carries their combined requirements.";
        });
        settings = lib.mkOption {
          type = lib.types.submoduleWith {
            specialArgs = {
              inherit pkgs;
              modulesPath = "${mnw}/modules";
            };
            modules = [
              "${mnw}/modules/options.nix"
              {options = lib.genAttrs ["assertions" "warnings"] (_: mylib.accumulatingOption (lib.mkOption {}));}
            ];
          };
          default = {};
          description = "mnw configuration that builds the Neovim package. Each feature module contributes its plugins and its own Lua runtime directory.";
        };
        package = packageOption (mkPackage pkgs null);
      };

    myconfig.always.roles.editor.holder = "neovim";

    myconfig.always.neovim.settings = {pkgs, ...}: {
      inherit (cfg) enable;
      plugins.start = lib.optionals (cfg.snacks != {}) [
        (pkgs.vimPlugins.snacks-nvim
          // {dependencies = lib.unique ((pkgs.vimPlugins.snacks-nvim.dependencies or []) ++ cfg.snacksDependencies);})
      ];
      initLua = lib.optionalString (cfg.snacks != {}) ''
        require("snacks").setup(${lib.generators.toLua {} cfg.snacks})
      '';
      neovim = neovim-nightly-overlay.packages.${pkgs.stdenv.system}.default;
      plugins.dev.grimoire = {
        pure = ./config;
        impure = "~/grimoire/abstractions/modules/neovim/config";
      };
    };

    hjem.ifEnabled = {
      packages = [
        cfg.package
      ];

      zsh.zabrze.snippets.neovim = {
        trigger = "nv";
        snippet = "nvim";
      };
    };

    # The nightly overlay's builds are pushed here; the anchor's own lock file
    # keeps them substitutable.
    darwin.ifEnabled.nix.settings = {
      extra-substituters = ["https://nix-community.cachix.org"];
      extra-trusted-public-keys = ["nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="];
    };

    # Bundle names depend on `myconfig`, so they stay inside `mkMerge`, whose
    # shape Denix reads before `myconfig` is evaluated.
    bundles.ifEnabled = {pkgs, ...}:
      lib.mkMerge [
        {
          neovim = {
            package = mkPackage pkgs null;
            publish = true;
          };
        }
        (lib.mapAttrs' (combination: resolved:
          lib.nameValuePair "neovim-${combination}" {
            package = mkPackage pkgs resolved;
            publish = true;
          })
        (lib.filterAttrs (_: resolved: themes.of resolved != null) myconfig.colorscheme.combinations))
      ];

    tests.fixture = ["roles.editor" "zsh.interactive.zabrze"];
    tests.cases = {pkgs, ...}: let
      hasTheme = package: lib.elem pkgs.vimPlugins.rose-pine package.config.plugins.start;
    in {
      upstream-wrap = {
        protects = "the typed settings build the package mnw's own evaluation of the same definitions builds";
        uses = ["colorscheme"];
        moduleSystem = "bundles";
        expr = result: result.packages.neovim.drvPath == (mnw.lib.wrap pkgs {imports = result.options.myconfig.neovim.settings.definitions;}).drvPath;
        expected = true;
      };
      upstream-assertions = {
        protects = "mnw's assertions, checked outside mnw's evaluation, fail the published package";
        uses = ["colorscheme"];
        modules.fixture-feature.myconfig.always.neovim.settings.assertions = [
          {
            assertion = false;
            message = "fixture";
          }
        ];
        moduleSystem = "bundles";
        expr = result: result.packages.neovim.drvPath;
        fails = true;
      };
      lower-source-warnings-reported = {
        protects = "warnings from every myconfig source reach mnw beside its own";
        uses = ["colorscheme"];
        modules.fixture-feature.myconfig.always.neovim.settings.warnings = ["fixture"];
        moduleSystem = "bundles";
        expr = result: lib.elem "fixture" result.packages.neovim.config.warnings;
        expected = true;
      };
      bundles = {
        protects = "one bundle is published per combination, and a combination's theme adds to the features' plugins";
        uses = ["colorscheme" "colorscheme.rose-pine"];
        moduleSystem = "bundles";
        host.myconfig.ifEnabled.roles.colorscheme = {
          enable = true;
          holder = "colorscheme.rose-pine";
        };
        modules.fixture-feature.myconfig.always.neovim.settings.plugins.start = [pkgs.vimPlugins.plenary-nvim];
        expr = result: {
          names = builtins.attrNames result.packages;
          plain = hasTheme result.packages.neovim;
          themed = hasTheme result.packages.neovim-rose-pine;
          kept = result.packages.neovim.config.plugins.start != [] && lib.all (plugin: lib.elem plugin result.packages.neovim-rose-pine.config.plugins.start) result.packages.neovim.config.plugins.start;
        };
        expected = {
          names = ["neovim" "neovim-rose-pine"];
          plain = false;
          themed = true;
          kept = true;
        };
      };
    };
  })
