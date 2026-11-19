{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "neovim.animations";
  meta.description = "Animate Neovim edits and movement while preserving existing key semantics.";
  options = {
    enable = delib.boolOption true;
    edit.enable = delib.boolOption true;
    scroll.enable = delib.boolOption true;
  };
  tests.fixture = ["neovim"];

  tests.cases = {pkgs, ...}: {
    startup-mappings = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "animation setup decorates redo mappings defined during startup and preserves an existing star mapping";
      build = result:
        pkgs.runCommand "neovim-animations-startup-mappings" {} ''
          export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
          export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
          mkdir -p "$HOME"
          ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${./tests/mappings.lua}"); if not ok then print(err); vim.cmd("cquit") end'
          touch "$out"
        '';
    };
  };

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start =
      lib.optionals cfg.edit.enable [pkgs.vimPlugins.tiny-glimmer-nvim]
      ++ lib.optionals cfg.scroll.enable [pkgs.vimPlugins.cinnamon-nvim];
    initLua = ''
      vim.g.grimoire_animations = ${lib.generators.toLua {} {
        edit = cfg.edit.enable;
        scroll = cfg.scroll.enable;
      }}
    '';
    plugins.dev.grimoire-animations = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/animations/config";
    };
  };
})
