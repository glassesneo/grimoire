{
  delib,
  lib,
  mylib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "neovim.bars";
  tests.fixture = ["neovim"];
  meta.description = "Compose Neovim status and buffer displays from placement-independent Heirline components.";

  options = {
    enable = delib.boolOption true;
    modeEnds = mylib.atomicOption (lib.mkOption {
      type = lib.types.submodule {
        options = {
          left = lib.mkOption {
            type = lib.types.str;
            default = "█";
          };
          right = lib.mkOption {
            type = lib.types.str;
            default = "█";
          };
        };
      };
      default = {};
      description = "Literal left and right mode-indicator glyphs, selected together independently of the colorscheme.";
    });
  };

  tests.cases = {pkgs, ...}: {
    mode-ends = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "declared mode-indicator ends reach the rendered layout as literal text independently of the colorscheme";
      host.myconfig.ifEnabled.neovim.bars.modeEnds = {
        left = "LEFT%{1+1}";
        right = "RIGHT%{1+1}";
      };
      build = result:
        pkgs.runCommand "neovim-bars-mode-ends" {} ''
          export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
          export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
          mkdir -p "$HOME"
          ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${./tests/mode-ends.lua}"); if not ok then print(err); vim.cmd("cquit") end'
          touch "$out"
        '';
    };
    label-width = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "middle-shortened labels fit their display-cell budget without splitting Unicode characters, retain identifying ends, and leave fitting labels unchanged";
      build = result:
        pkgs.runCommand "neovim-bars-label-width" {} ''
          export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
          export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
          mkdir -p "$HOME"
          ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${./tests/width.lua}"); if not ok then print(err); vim.cmd("cquit") end'
          touch "$out"
        '';
    };
    components = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "display components read their target buffer rather than the focused buffer, preserve literal names, and reflect changing state without installing a layout";
      build = result:
        pkgs.runCommand "neovim-bars-components" {} ''
          export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
          export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
          mkdir -p "$HOME"
          ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${./tests/components.lua}"); if not ok then print(err); vim.cmd("cquit") end'
          touch "$out"
        '';
    };
  };

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [pkgs.vimPlugins.heirline-nvim];
    initLua = ''
      vim.g.grimoire_bars = ${lib.generators.toLua {} {inherit (cfg) modeEnds;}}
    '';
    plugins.dev.grimoire-bars = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/bars/config";
    };
  };
})
