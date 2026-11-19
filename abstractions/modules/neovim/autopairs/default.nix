{
  delib,
  lib,
  ...
}:
delib.module {
  name = "neovim.autopairs";
  tests.fixture = ["neovim"];
  meta.description = "Insert paired delimiters and track generated closers in Neovim.";

  options.enable = delib.boolOption true;

  tests.cases = {pkgs, ...}: {
    behavior = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "typed pairs insert and delete together, only generated closers are skipped across edits and undo, and replacing the pair data changes the mappings";
      build = result:
        pkgs.runCommand "neovim-autopairs-behavior" {} ''
          export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
          export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
          mkdir -p "$HOME"
          ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${./tests/input.lua}"); if not ok then print(err); vim.cmd("cquit") end'
          touch "$out"
        '';
    };
  };

  myconfig.ifEnabled.neovim.settings = _: {
    plugins.dev.grimoire-autopairs = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/autopairs/config";
    };
  };
}
