{
  delib,
  lib,
  ...
}:
delib.module {
  name = "neovim.cmdline";
  meta.description = "Present Neovim command and search input in a popup without replacing messages or notifications.";
  options.enable = delib.boolOption true;
  tests.fixture = ["neovim"];

  tests.cases = {pkgs, ...}: {
    popup-resize = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "the command popup fits narrow editors and restores its preferred width when the editor grows";
      build = result:
        pkgs.runCommand "neovim-cmdline-popup-resize" {} ''
          export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
          export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
          mkdir -p "$HOME"
          ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${./tests/resize.lua}"); if not ok then print(err); vim.cmd("cquit") end'
          touch "$out"
        '';
    };
  };

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [pkgs.vimPlugins.noice-nvim];
    plugins.dev.grimoire-cmdline = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/cmdline/config";
    };
  };
}
