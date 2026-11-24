{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) vim-zellij-navigator;
in
  delib.module {
    name = "zellij.navigator";
    tests.fixture = ["zellij"];
    meta.description = "Move focus across Zellij panes through vim-zellij-navigator, which leaves the keys to Neovim when it runs in the focused pane.";

    options.enable = delib.boolOption true;

    myconfig.ifEnabled = {
      zellij.keybinds.shared = lib.mapAttrs' (key: direction:
        lib.nameValuePair "Alt ${key}" [
          {
            MessagePlugin = {
              args = ["file:${vim-zellij-navigator}"];
              children = {
                name = "move_focus";
                payload = direction;
                move_mod = "alt";
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

    hjem.ifEnabled = {
      zellij.pluginPermissions.${builtins.unsafeDiscardStringContext "${vim-zellij-navigator}"} = [
        "WriteToStdin"
        "ChangeApplicationState"
        "ReadApplicationState"
      ];
    };
  }
