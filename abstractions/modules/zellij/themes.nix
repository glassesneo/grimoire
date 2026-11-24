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
