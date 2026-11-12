{delib, ...}:
delib.module {
  name = "neovim.navigation";
  tests.fixture = ["neovim"];
  meta.description = "Move focus across Neovim windows and adjacent Zellij panes.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [pkgs.vimPlugins.zellij-nav-nvim];
    plugins.dev.grimoire-navigation = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/navigation/config";
    };
  };
}
