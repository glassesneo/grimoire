{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.flakes ./anchors.json) blink-cmp;

  # The upstream overlays only extend `vimPlugins` and call `final.callPackage`,
  # so they apply over `pkgs` without instantiating another Nixpkgs fixpoint
  # in every module system evaluation, as `appendOverlays` would.
  blinkPlugins = pkgs: let
    final = pkgs // plugins // {callPackage = pkgs.newScope plugins;};
    plugins = lib.foldl' (prev: overlay: prev // overlay final (pkgs // prev)) {} [
      blink-cmp.inputs.blink-lib.overlays.default
      blink-cmp.overlays.default
    ];
  in
    plugins.vimPlugins;
in
  delib.module {
    name = "neovim.completion";
    meta.description = "Provide insert-mode and command-line completion in Neovim.";

    options.enable = delib.boolOption true;

    myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
      plugins.start = [
        # nixpkgs only packages blink.cmp 1.x; the upstream flake builds v2 with
        # its Rust fuzzy matcher and blink.lib dependency.
        (blinkPlugins pkgs).blink-cmp
        pkgs.vimPlugins.blink-ripgrep-nvim
        pkgs.vimPlugins.colorful-menu-nvim
        pkgs.vimPlugins.friendly-snippets
      ];
      plugins.dev.grimoire-completion = {
        pure = ./config;
        impure = "~/grimoire/abstractions/modules/neovim/completion/config";
      };
    };
  }
