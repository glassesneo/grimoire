{
  delib,
  inputs,
  ...
}:
delib.module {
  name = "neovim.completion";
  meta.description = "Provide insert-mode and command-line completion in Neovim.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [
      inputs.blink-cmp.packages.${pkgs.stdenv.system}.blink-cmp
      pkgs.vimPlugins.blink-ripgrep-nvim
      pkgs.vimPlugins.colorful-menu-nvim
      pkgs.vimPlugins.friendly-snippets
    ];
    plugins.dev.ark-completion = {
      pure = ./config;
      impure = "~/ark/abstractions/modules/neovim/completion/config";
    };
  };
}
