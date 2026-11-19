{delib, ...}:
delib.module {
  name = "neovim.surround";
  tests.fixture = ["neovim"];
  meta.description = "Edit surrounding delimiters through a consistent Neovim command namespace.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [pkgs.vimPlugins.nvim-surround];
    initLua = ''
      vim.g.nvim_surround_no_mappings = true
    '';
    plugins.dev.grimoire-surround = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/surround/config";
    };
  };
}
