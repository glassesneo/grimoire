{delib, ...}:
delib.module {
  name = "neovim.lsp";
  tests.fixture = ["neovim"];
  meta.description = "Connect Neovim to language servers and format buffers through them.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [pkgs.vimPlugins.nvim-lspconfig];
    # Nix files are edited outside any devShell, so its server travels
    # with the editor; other language servers come from project shells.
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
