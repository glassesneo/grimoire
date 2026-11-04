{
  delib,
  inputs,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) cask2nix brew-api brew-taps-api;
in
  delib.module ({myconfig, ...}: let
    pkgs = inputs.nixpkgs.legacyPackages.${myconfig.host.system};
  in {
    name = "casks";
    meta.description = "Expose Homebrew casks, packaged by cask2nix from the official and third-party taps, to modules.";

    options = {
      packages = delib.readOnly (delib.lazyAttrsOfOption delib.types.package (import "${cask2nix}/casks.nix" {
        inherit pkgs;
        source = brew-api;
      }) "Casks of the official tap, by token.");

      taps = delib.readOnly (delib.lazyAttrsOfOption (delib.types.lazyAttrsOf (delib.types.lazyAttrsOf delib.types.package)) (import "${cask2nix}/taps.nix" {
        inherit pkgs;
        source = "${brew-taps-api}/taps";
      }) "Casks of third-party taps, by tap owner, tap name and token.");
    };
  })
