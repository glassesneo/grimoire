{
  delib,
  lib,
  mylib,
  ...
}: let
  themes = import ../themes.nix {inherit lib mylib;};
in
  delib.module ({myconfig, ...}: let
    inherit (myconfig.roles.colorscheme) resolved;
  in {
    name = "neovim.colorscheme";
    tests.fixture = ["neovim" "roles.colorscheme"];
    meta = {
      description = "Give Neovim the colorscheme plugin of the held color scheme.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    constraints.ifEnabled = [(themes.constraint resolved)];

    myconfig.ifEnabled.neovim.settings = {pkgs, ...}: themes.of resolved pkgs resolved;
  })
