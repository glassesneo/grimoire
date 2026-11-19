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

    # Part of the settings the host's package is built from; bundles add a
    # combination's theme themselves.
    myconfig.ifEnabled.neovim.settings = {pkgs, ...}: themes.of resolved pkgs resolved;
  })
