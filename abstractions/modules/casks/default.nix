{
  delib,
  inputs,
  ...
}:
delib.module ({myconfig, ...}: let
  pkgs = inputs.nixpkgs.legacyPackages.${myconfig.host.system};
in {
  name = "casks";
  meta.description = "Expose Homebrew casks, packaged by cask2nix from the official and third-party taps, to modules.";

  options = {
    packages = delib.readOnly (delib.lazyAttrsOfOption delib.types.package (inputs.cask2nix.lib.mkCasks {
      inherit pkgs;
      source = inputs.brew-api;
    }) "Casks of the official tap, by token.");

    taps = delib.readOnly (delib.lazyAttrsOfOption (delib.types.lazyAttrsOf (delib.types.lazyAttrsOf delib.types.package)) (inputs.cask2nix.lib.mkTaps {
      inherit pkgs;
      source = "${inputs.brew-taps-api}/taps";
    }) "Casks of third-party taps, by tap owner, tap name and token.");
  };
})
