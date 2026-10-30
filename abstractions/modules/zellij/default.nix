{
  delib,
  lib,
  mylib,
  ...
}:
delib.module {
  name = "zellij";
  meta.description = "Provide and configure the Zellij terminal multiplexer, and own its configuration file.";

  options.enable = delib.boolOption true;

  hjem.always.options.zellij.keybinds =
    mylib.fragments.option
    // {
      description = "KDL `bind` nodes rendered into the `shared` section of Zellij's keybindings, which replace Zellij's default keybindings.";
    };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: {
    packages = [pkgs.zellij];

    xdg.config.files = {
      "zellij/config.kdl" = {
        exclusive = true;
        source = pkgs.replaceVars ./config.kdl {
          keybinds = mylib.fragments.render config.zellij.keybinds;
        };
      };
      # Replaces the built-in default layout, which also serves as the
      # template of new tabs.
      "zellij/layouts/default.kdl" = {
        exclusive = true;
        source = ./layouts/default.kdl;
      };
    };
  };

  checks = {
    pkgs,
    home,
    ...
  }: let
    configDir = "${home}/fixture-config";
  in {
    valid-config = {
      modules.fixture.hjem.always = {
        xdg.config.directory = configDir;
        zellij.keybinds.fixture.text = ''bind "Super x" { CloseFocus; }'';
      };
      build = result: let
        source = target:
          (lib.findFirst (file: file.target == target)
            (throw "Missing fixture file ${target}")
            result.manifest.files).source;
      in
        pkgs.runCommand "zellij-valid-config" {
          config = source "${configDir}/zellij/config.kdl";
          nativeBuildInputs = [pkgs.zellij];
        } ''
          export HOME=$TMPDIR
          zellij --config "$config" setup --check
          grep -F 'bind "Super x" { CloseFocus; }' "$config"
          touch "$out"
        '';
    };
  };
}
