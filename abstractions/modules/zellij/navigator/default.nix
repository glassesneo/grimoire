{
  delib,
  lib,
  ...
}: let
  # Pinned instead of the release URL, which Zellij would fetch at run time.
  plugin = pkgs:
    pkgs.fetchurl {
      url = "https://github.com/hiasr/vim-zellij-navigator/releases/download/0.3.0/vim-zellij-navigator.wasm";
      hash = "sha256-d+Wi9i98GmmMryV0ST1ddVh+D9h3z7o0xIyvcxwkxY0=";
    };
in
  delib.module {
    name = "zellij.navigator";
    meta.description = "Move focus across Zellij panes through vim-zellij-navigator, which leaves the keys to Neovim when it runs in the focused pane.";

    options.enable = delib.boolOption true;

    # Every call repeats the configuration because the plugin keeps the one
    # it was first loaded with.
    myconfig.ifEnabled = {pkgs, ...}: {
      zellij.keybinds.shared = lib.mapAttrs' (key: direction:
        lib.nameValuePair "Ctrl ${key}" [
          {
            MessagePlugin = {
              args = ["file:${plugin pkgs}"];
              children = {
                name = "move_focus";
                payload = direction;
                move_mod = "ctrl";
              };
            };
          }
        ]) {
        h = "left";
        j = "down";
        k = "up";
        l = "right";
      };
    };

    # Zellij keys the cache by the plugin's path. An attribute name cannot
    # carry the store path's context; the keybindings keep the dependency.
    hjem.ifEnabled = {pkgs, ...}: {
      zellij.pluginPermissions.${builtins.unsafeDiscardStringContext "${plugin pkgs}"} = [
        "WriteToStdin"
        "ChangeApplicationState"
        "ReadApplicationState"
      ];
    };
  }
