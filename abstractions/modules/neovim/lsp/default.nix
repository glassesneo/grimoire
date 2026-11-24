{delib, ...}:
delib.module {
  name = "neovim.lsp";
  tests.fixture = ["neovim"];
  meta.description = "Connect Neovim to language servers and format buffers through them.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [pkgs.vimPlugins.nvim-lspconfig];
    extraBinPath = [
      pkgs.alejandra
      pkgs.nil
    ];
    plugins.dev.grimoire-lsp = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/lsp/config";
    };
  };
}
