{
  delib,
  lib,
  ...
}:
delib.module {
  name = "neovim.motion";
  tests.fixture = ["neovim"];
  meta.description = "Provide search and line-movement aids in Neovim.";

  options.enable = delib.boolOption true;

  tests.cases = {pkgs, ...}: {
    stay-star = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "stay-star updates forward literal keyword search and highlighting without moving or replacing the previous search on empty input";
      build = result:
        pkgs.runCommand "neovim-motion-behavior" {} ''
          export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
          export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
          mkdir -p "$HOME"
          ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${./tests/search.lua}"); if not ok then print(err); vim.cmd("cquit") end'
          touch "$out"
        '';
    };
  };

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = let
      # Bundles have no user Nixpkgs allow-list; scope this permission to the
      # one plugin rather than changing the package set for every feature.
      eyelinerPkgs = import pkgs.path {
        inherit (pkgs.stdenv.hostPlatform) system;
        config.allowUnfreePackages = ["eyeliner.nvim"];
      };
    in [pkgs.vimPlugins.mini-jump eyelinerPkgs.vimPlugins.eyeliner-nvim pkgs.vimPlugins.numb-nvim];
    plugins.dev.grimoire-motion = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/motion/config";
    };
  };
}
