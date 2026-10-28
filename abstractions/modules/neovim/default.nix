{
  delib,
  inputs,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "neovim";
  meta.description = "Provide and configure neovim";

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption true;
      settings = lib.mkOption {
        type = lib.types.deferredModule;
        default = {};
        description = "mnw configuration that builds the Neovim package. Each feature module contributes its plugins and its own Lua runtime directory.";
      };
      package = packageOption (inputs.mnw.lib.wrap pkgs cfg.settings) {defaultText = lib.literalExpression "inputs.mnw.lib.wrap pkgs myconfig.neovim.settings";};
    };

  myconfig.always.neovim.settings = {pkgs, ...}: {
    inherit (cfg) enable;
    neovim = inputs.neovim-nightly-overlay.packages.${pkgs.stdenv.system}.default;
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
  };

  bundles.ifEnabled.neovim = {
    inherit (cfg) package;
  };

  # A fixture stands in for a feature module, so the case covers how
  # contributions reach the package rather than any particular feature.
  checks = {pkgs, ...}: {
    feature-contribution = {
      uses = ["publication"];
      modules.fixture-feature.myconfig.always.neovim.settings = {
        plugins.dev.fixture.pure = pkgs.emptyDirectory;
      };
      moduleSystem = "bundles";
      expr = result: builtins.attrNames result.packages.neovim.config.plugins.dev;
      expected = ["fixture" "grimoire"];
    };
  };
})
