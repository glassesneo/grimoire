{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.flakes ./anchors.json) blink-cmp;

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
    tests.fixture = ["neovim"];
    meta.description = "Provide insert-mode and command-line completion in Neovim.";

    options.enable = delib.boolOption true;

    myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
      plugins.start = [
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
