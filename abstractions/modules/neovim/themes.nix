{
  lib,
  mylib,
}:
mylib.schemeThemes {
  name = "neovim";
  themes = {
    rose-pine = pkgs: _: {
      plugins.start = [pkgs.vimPlugins.rose-pine];
      # After every feature's setup: the scheme sets the final highlights.
      initLua = lib.mkAfter ''
        require("rose-pine").setup({ variant = "main", dark_variant = "main" })
        vim.cmd.colorscheme("rose-pine")
      '';
    };
  };
}
