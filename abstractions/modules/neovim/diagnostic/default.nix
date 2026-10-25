{delib, ...}:
delib.module {
  name = "neovim.diagnostic";
  meta.description = "Display diagnostics in Neovim buffers.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [pkgs.vimPlugins.tiny-inline-diagnostic-nvim];
    plugins.dev.grimoire-diagnostic = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/diagnostic/config";
    };
  };
}
