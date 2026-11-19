{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ../anchors.json) omniwm;
  upstream = import "${omniwm}/nix/lib.nix" {inherit lib;};
in
  delib.module ({myconfig, ...}: {
    name = "omniwm.colorscheme";
    tests.fixture = ["omniwm" "roles.colorscheme"];
    meta = {
      description = "Color OmniWM's focused-window border with the held color scheme's cursor color.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    myconfig.ifEnabled.omniwm.settings.borders.color = upstream.colors.fromHex myconfig.roles.colorscheme.resolved.palette.cursor;
  })
