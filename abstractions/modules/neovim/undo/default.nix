{
  delib,
  lib,
  ...
}:
delib.module {
  name = "neovim.undo";
  tests.fixture = ["neovim"];
  meta.description = "Browse Neovim undo branches and changes with Snacks.";

  options.enable = delib.boolOption true;

  tests.cases = {pkgs, ...}: {
    fresh-cache = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "opening undo history prepares its cache directory in a fresh session without relying on finder";
      build = result:
        pkgs.runCommand "neovim-undo-cache" {} ''
          export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
          export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
          mkdir -p "$HOME"
          ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${./tests/cache.lua}"); if not ok then print(err); vim.cmd("cquit") end'
          touch "$out"
        '';
    };
  };

  myconfig.ifEnabled.neovim.snacks.picker.enabled = true;

  myconfig.ifEnabled.neovim.settings = _: {
    plugins.dev.grimoire-undo = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/undo/config";
    };
  };
}
