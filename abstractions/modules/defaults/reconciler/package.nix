# Owns the CoreFoundation-linked reconciler build and its fake-preferences
# state-machine specs.
{
  crystal,
  lib,
}:
crystal.buildCrystalPackage {
  pname = "hjem-defaults-reconcile";
  version = "1";
  # The sources and specs, so editing this file does not rebuild the binary.
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.difference ./. ./package.nix;
  };
  format = "crystal";
  crystalBinaries.hjem-defaults-reconcile.src = "main.cr";
  doCheck = true;
  doInstallCheck = true;
  meta.platforms = lib.platforms.darwin;
}
