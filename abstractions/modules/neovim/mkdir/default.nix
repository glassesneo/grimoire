{
  delib,
  lib,
  ...
}:
delib.module {
  name = "neovim.mkdir";
  tests.fixture = ["neovim"];
  meta.description = "Create missing parent directories when saving ordinary Neovim files.";

  options.enable = delib.boolOption true;

  tests.cases = {pkgs, ...}: {
    behavior = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "ordinary save targets, including alternate write paths, get parent directories without creating directories for special buffers or URI targets";
      build = result:
        pkgs.runCommand "neovim-mkdir-behavior" {} ''
          export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
          export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
          mkdir -p "$HOME"
          ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${./tests/save.lua}"); if not ok then print(err); vim.cmd("cquit") end'
          touch "$out"
        '';
    };
  };

  myconfig.ifEnabled.neovim.settings = _: {
    plugins.dev.grimoire-mkdir = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/mkdir/config";
    };
  };
}
