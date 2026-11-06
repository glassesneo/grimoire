{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.flakes ./anchors.json) mnw neovim-nightly-overlay;

  # Neovim's implementation of each scheme it supports, by scheme name: mnw
  # settings built from Nixpkgs and the resolved scheme.
  themes = mylib.schemeThemes {
    name = "neovim";
    themes = {
      # The upstream colorscheme covers far more highlight groups than a palette
      # carries; this scheme has only the main variant.
      rose-pine = pkgs: _: {
        plugins.start = [pkgs.vimPlugins.rose-pine];
        initLua = ''
          require("rose-pine").setup({ variant = "main", dark_variant = "main" })
          vim.cmd.colorscheme("rose-pine")
        '';
      };
    };
  };
in
  delib.module ({
    cfg,
    opt,
    myconfig,
    ...
  }: let
    # Builds the package from the evaluated settings and a resolved scheme, or
    # null for none. Upstream assertions and warnings are checked here, as
    # mnw's own `wrap` does before it calls `uncheckedWrap`.
    mkPackage = pkgs: resolved: let
      base = opt.settings.valueMeta.configuration;
      final =
        if resolved == null
        then base
        # The theme is part of this module's contribution, so it merges with
        # the other modules' settings instead of replacing their lists.
        else
          base.extendModules {
            modules = [(mylib.sources.prioritize mylib.sources.priorities.module base.options (themes.of resolved pkgs resolved))];
          };
      failedAssertions = mylib.assertions.failed final.config.assertions;
    in
      if failedAssertions != []
      then throw "\nFailed mnw assertions:\n${lib.concatMapStrings (message: "- ${message}\n") failedAssertions}"
      else lib.showWarnings final.config.warnings (mnw.lib.uncheckedWrap pkgs final.config);

    colorscheme =
      if themes.select cfg myconfig.colorscheme.resolved != null
      then myconfig.colorscheme.resolved
      else null;
  in {
    name = "neovim";
    meta.description = "Provide and configure neovim";

    options = {pkgs, ...}:
      with delib; {
        enable = boolOption true;
        useColorscheme = boolOption true "Whether the package takes its theme from `colorscheme.resolved`.";
        settings = lib.mkOption {
          # mnw's own option declarations, as its modules evaluate them.
          type = lib.types.submoduleWith {
            specialArgs = {
              inherit pkgs;
              modulesPath = "${mnw}/modules";
            };
            modules = [
              "${mnw}/modules/options.nix"
              # Every source's assertions and warnings reach mnw beside its own.
              {options = lib.genAttrs ["assertions" "warnings"] (_: mylib.accumulatingOption (lib.mkOption {}));}
            ];
          };
          default = {};
          description = "mnw configuration that builds the Neovim package. Each feature module contributes its plugins and its own Lua runtime directory.";
        };
        package = packageOption (mkPackage pkgs colorscheme);
      };

    constraints.ifEnabled = [(themes.constraint cfg myconfig.colorscheme.resolved)];

    myconfig.always.neovim.settings = {pkgs, ...}: {
      inherit (cfg) enable;
      neovim = neovim-nightly-overlay.packages.${pkgs.stdenv.system}.default;
      plugins.dev.grimoire = {
        pure = ./config;
        # Read by the devMode package so Lua edits apply without a rebuild.
        impure = "~/grimoire/abstractions/modules/neovim/config";
      };
    };

    hjem.ifEnabled = {
      packages = [
        cfg.package
      ];

      # A name rather than a store path: the session keeps the value it logged
      # in with, and a path would go stale when the package is rebuilt.
      environment.sessionVariables.EDITOR = "nvim";

      zsh.zabrze.snippets.neovim = {
        trigger = "nv";
        snippet = "nvim";
      };
    };

    # The nightly overlay pushes its Neovim builds to this cache; they stay
    # substitutable because the anchor evaluates with its own lock file.
    darwin.ifEnabled.nix.settings = {
      extra-substituters = ["https://nix-community.cachix.org"];
      extra-trusted-public-keys = ["nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="];
    };

    # `neovim` has no theme; `neovim-<combination>` follows each combination of
    # `colorscheme.combinations` whose scheme has a theme, whatever the host selects.
    # The bundle names depend on `myconfig`, so they stay inside `mkMerge`,
    # whose shape Denix can read before `myconfig` is evaluated.
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

    # A fixture stands in for a feature module, so the case covers how
    # contributions reach the package rather than any particular feature.
    tests = {pkgs, ...}: let
      hasTheme = package: lib.elem pkgs.vimPlugins.rose-pine package.config.plugins.start;
    in {
      # The typed settings must build what mnw's own evaluation of the same
      # definitions builds, which also catches a moved upstream options file.
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
        uses = ["colorscheme"];
        moduleSystem = "bundles";
        # The host's selection does not change which bundles are published.
        host.myconfig.ifEnabled.colorscheme.selection.name = "rose-pine";
        modules.fixture-feature.myconfig.always.neovim.settings.plugins.start = [pkgs.vimPlugins.plenary-nvim];
        expr = result: {
          names = builtins.attrNames result.packages;
          plain = hasTheme result.packages.neovim;
          themed = hasTheme result.packages.neovim-rose-pine;
          # The theme adds to the features' plugins.
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
