{
  delib,
  inputs,
  mylib,
  ...
}:
delib.module {
  name = "casks";
  meta.description = "Expose Homebrew casks, packaged by cask2nix from the official and third-party taps, to modules.";

  # The shared Nixpkgs of the evaluated system, so a cask means the same in
  # every module system, including bundles, which evaluate without a host.
  options = {pkgs, ...}: let
    shared = inputs.nixpkgs.legacyPackages.${pkgs.stdenv.hostPlatform.system};
    inherit (mylib.anchors.sources ./anchors.json) cask2nix brew-api brew-taps-api;
  in {
    packages = delib.readOnly (delib.lazyAttrsOfOption delib.types.package (import "${cask2nix}/casks.nix" {
      pkgs = shared;
      source = brew-api;
    }) "Casks of the official tap, by token.");

    taps = delib.readOnly (delib.lazyAttrsOfOption (delib.types.lazyAttrsOf (delib.types.lazyAttrsOf delib.types.package)) (import "${cask2nix}/taps.nix" {
      pkgs = shared;
      source = "${brew-taps-api}/taps";
    }) "Casks of third-party taps, by tap owner, tap name and token.");
  };
}
