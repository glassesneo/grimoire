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
        default = {
          inherit (cfg) enable;
          neovim = inputs.neovim-nightly-overlay.packages.${pkgs.stdenv.system}.default;
          plugins.dev.ark = {
            pure = ./config;
            # Read by the devMode package so Lua edits apply without a rebuild.
            impure = "~/ark/abstractions/modules/neovim/config";
          };
        };
      };
      package = packageOption (inputs.mnw.lib.wrap pkgs cfg.settings);
    };

  hjem.ifEnabled = {
    packages = [
      cfg.package
    ];
  };

  bundles.ifEnabled.neovim = {
    inherit (cfg) package;
  };
})
