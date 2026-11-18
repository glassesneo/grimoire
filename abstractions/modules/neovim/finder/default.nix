{delib, ...}:
delib.module {
  name = "neovim.finder";
  tests.fixture = ["neovim"];
  meta.description = "Find files, search their contents and browse directories in Neovim with Snacks.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [pkgs.vimPlugins.snacks-nvim];
    extraBinPath = [pkgs.fd pkgs.ripgrep];
    plugins.dev.grimoire-finder = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/finder/config";
    };
  };
}
