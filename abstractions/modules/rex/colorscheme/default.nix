{
  delib,
  lib,
  mylib,
  ...
}:
delib.module ({myconfig, ...}: let
  inherit (myconfig.roles.colorscheme) resolved;
  name = lib.concatStringsSep " " (lib.filter (part: part != null) [resolved.name resolved.variant]);
in {
  name = "rex.colorscheme";
  tests.fixture = ["exclusive" "rex" "roles.colorscheme"];
  meta = {
    description = "Generate Rex's dark theme from the held color scheme's palette; Rex selects it only once `rex-import-theme` runs.";
    follows = ["colorscheme"];
  };

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    themeFile = "${config.xdg.config.directory}/rex/themes/${name}";
  in {
    # Rex keeps imported themes inside its preferences and accepts these
    # actions only while Remote Control is on, so this runs by hand with the
    # `rex` that the rex module provides.
    packages = [
      (pkgs.writeShellScriptBin "rex-import-theme" ''
        set -e
        rex do client.theme.import path=${lib.escapeShellArg themeFile}
        rex do client.setting.themes.dark.palette value=${lib.escapeShellArg name}
      '')
    ];

    xdg.config.files."rex/themes/${name}" = {
      exclusive = true;
      # Rex imports Ghostty's theme format.
      text = lib.generators.toKeyValue {
        listsAsDuplicateKeys = true;
        mkKeyValue = lib.generators.mkKeyValueDefault {} " = ";
      } (mylib.colorschemes.ghosttyTheme resolved.palette);
    };
  };
})
