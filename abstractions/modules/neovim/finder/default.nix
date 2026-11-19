{delib, ...}: let
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
  delib.module {
    name = "neovim.finder";
    tests.fixture = ["neovim"];
    meta.description = "Find files, search their contents and browse directories in Neovim with Snacks.";

    options.enable = delib.boolOption true;

    myconfig.ifEnabled.neovim.snacks = {
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

    myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
      extraBinPath = [pkgs.fd pkgs.ripgrep];
      plugins.dev.grimoire-finder = {
        pure = ./config;
        impure = "~/grimoire/abstractions/modules/neovim/finder/config";
      };
    };
  }
