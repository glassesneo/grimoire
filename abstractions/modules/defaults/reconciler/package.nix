# Owns the CoreFoundation-linked reconciler build and its fake-preferences
# state-machine specs.
{
  crystal,
  lib,
}:
crystal.buildCrystalPackage {
  pname = "hjem-defaults-reconcile";
  version = "1";
  src = ./.;
  format = "crystal";
  crystalBinaries.hjem-defaults-reconcile.src = "main.cr";
  doCheck = true;
  doInstallCheck = true;
  meta.platforms = lib.platforms.darwin;
}
