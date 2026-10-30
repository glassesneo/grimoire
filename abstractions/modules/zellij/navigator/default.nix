{
  delib,
  lib,
  ...
}:
delib.module {
  name = "zellij.navigator";
  meta.description = "Move focus across Zellij panes through vim-zellij-navigator, which leaves the keys to Neovim when it runs in the focused pane.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: let
    # Pinned instead of the release URL, which Zellij would fetch at run time.
    plugin = pkgs.fetchurl {
      url = "https://github.com/hiasr/vim-zellij-navigator/releases/download/0.3.0/vim-zellij-navigator.wasm";
      hash = "sha256-d+Wi9i98GmmMryV0ST1ddVh+D9h3z7o0xIyvcxwkxY0=";
    };
    # Every call repeats the configuration because the plugin keeps the one
    # it was first loaded with.
    bind = key: direction: ''
      bind "Ctrl ${key}" {
          MessagePlugin "file:${plugin}" {
              name "move_focus"
              payload "${direction}"
              move_mod "ctrl"
          }
      }
    '';
  in {
    zellij.keybinds.navigator.text = lib.concatStrings [
      (bind "h" "left")
      (bind "j" "down")
      (bind "k" "up")
      (bind "l" "right")
    ];
  };

  checks = {
    pkgs,
    home,
    ...
  }: let
    configDir = "${home}/fixture-config";
  in {
    valid-config = {
      uses = ["zellij"];
      modules.fixture.hjem.always.xdg.config.directory = configDir;
      build = result: let
        config =
          (lib.findFirst (file: file.target == "${configDir}/zellij/config.kdl")
            (throw "Missing fixture Zellij configuration")
            result.manifest.files).source;
      in
        pkgs.runCommand "zellij-navigator-valid-config" {
          inherit config;
          nativeBuildInputs = [pkgs.zellij];
        } ''
          export HOME=$TMPDIR
          zellij --config "$config" setup --check
          plugin=$(grep -o -m1 'file:/nix/store/[^"]*' "$config")
          test -f "''${plugin#file:}"
          touch "$out"
        '';
    };
  };
}
