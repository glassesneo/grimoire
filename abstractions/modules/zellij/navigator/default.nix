{
  delib,
  lib,
  mylib,
  ...
}: let
  # Pinned instead of the release URL, which Zellij would fetch at run time.
  inherit (mylib.anchors.sources ./anchors.json) vim-zellij-navigator;
in
  delib.module {
    name = "zellij.navigator";
    meta.description = "Move focus across Zellij panes through vim-zellij-navigator, which leaves the keys to Neovim when it runs in the focused pane.";

    options.enable = delib.boolOption true;

    # Every call repeats the configuration because the plugin keeps the one
    # it was first loaded with.
    myconfig.ifEnabled = {
      zellij.keybinds.shared = lib.mapAttrs' (key: direction:
        lib.nameValuePair "Ctrl ${key}" [
          {
            MessagePlugin = {
              args = ["file:${vim-zellij-navigator}"];
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
    hjem.ifEnabled = {
      zellij.pluginPermissions.${builtins.unsafeDiscardStringContext "${vim-zellij-navigator}"} = [
        "WriteToStdin"
        "ChangeApplicationState"
        "ReadApplicationState"
      ];
    };
  }
