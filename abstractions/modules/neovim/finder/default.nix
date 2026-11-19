{
  delib,
  lib,
  ...
}: let
  layout = {
    cycle = true;
    col = 0.45;
    height = 0.5;
    row = -2;
    width = 0.98;
    position = "float";
  };
  searchable = {
    hidden = true;
    ignored = false;
    layout.layout = layout;
  };
in
  delib.module ({cfg, ...}: {
    name = "neovim.finder";
    tests.fixture = ["neovim"];
    meta.description = "Find files, search their contents and browse directories in Neovim with Snacks.";

    options = {
      enable = delib.boolOption true;
      icons = delib.boolOption true "Request nvim-web-devicons for Snacks file icons; other enabled features may also supply an icon provider.";
    };

    tests.cases = _: {
      icons-disabled = {
        moduleSystem = "bundles";
        uses = ["colorscheme"];
        protects = "disabling finder icon integration retains Snacks without requesting the optional icon dependency";
        host.myconfig.ifEnabled.neovim.finder.icons = false;
        expr = result: {
          snacks = result.packages.neovim.config.plugins.startAttrs ? "snacks.nvim";
          icons = result.packages.neovim.config.plugins.startAttrs ? nvim-web-devicons;
        };
        expected = {
          snacks = true;
          icons = false;
        };
      };
    };

    myconfig.ifEnabled = {pkgs, ...}: {
      neovim.snacksDependencies = lib.optionals cfg.icons [pkgs.vimPlugins.nvim-web-devicons];

      neovim.snacks = {
        explorer = {
          enabled = true;
          replace_netrw = true;
        };
        picker = {
          enabled = true;
          sources = {
            smart = searchable;
            files = searchable;
            grep = searchable;
            explorer = {
              hidden = true;
              ignored = false;
              git_untracked = true;
              layout.layout = {
                box = "vertical";
                position = "left";
              };
            };
          };
        };
      };

      neovim.settings = {
        extraBinPath = [pkgs.fd pkgs.ripgrep];
        plugins.dev.grimoire-finder = {
          pure = ./config;
          impure = "~/grimoire/abstractions/modules/neovim/finder/config";
        };
      };
    };
  })
