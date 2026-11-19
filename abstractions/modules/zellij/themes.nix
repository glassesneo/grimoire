# Zellij's table of scheme themes, read by `zellij` for its bundles and by
# `zellij.colorscheme` for the host. An entry is the theme the file declares
# and the file, which Zellij loads from the `themes` directory beside
# `config.kdl`.
{mylib}: let
  inherit (mylib.anchors.sources ./anchors.json) rose-pine;
in
  mylib.schemeThemes {
    name = "zellij";
    themes.rose-pine = {
      name = "rose-pine";
      source = _: "${rose-pine}/dist/rose-pine.kdl";
    };
  }
