{
  lib,
  mylib,
}:
mylib.schemeThemes {
  name = "neovim";
  themes = {
    rose-pine = pkgs: _: {
      plugins.start = [pkgs.vimPlugins.rose-pine];
      initLua = lib.mkAfter ''
        require("rose-pine").setup({ variant = "main", dark_variant = "main" })
        vim.cmd.colorscheme("rose-pine")
      '';
    };
  };
}
