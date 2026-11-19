{delib, ...}:
delib.module {
  name = "neovim.git";
  tests.fixture = ["neovim"];
  meta.description = "Display Git changes and expose hunk navigation, previews and blame in Neovim.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [pkgs.vimPlugins.gitsigns-nvim];
    extraBinPath = [pkgs.git];
    plugins.dev.grimoire-git = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/git/config";
    };
  };
}
