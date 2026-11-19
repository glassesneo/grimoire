# Neovim's table of scheme themes, read by `neovim` for its bundles and by
# `neovim.colorscheme` for the host. An entry builds mnw settings from Nixpkgs
# and the resolved scheme.
{
  lib,
  mylib,
}:
mylib.schemeThemes {
  name = "neovim";
  themes = {
    # The upstream colorscheme covers far more highlight groups than a palette
    # carries; this scheme has only the main variant.
    rose-pine = pkgs: _: {
      plugins.start = [pkgs.vimPlugins.rose-pine];
      # After every feature's setup, as the scheme sets the final highlights.
      initLua = lib.mkAfter ''
        require("rose-pine").setup({ variant = "main", dark_variant = "main" })
        vim.cmd.colorscheme("rose-pine")
      '';
    };
  };
}
