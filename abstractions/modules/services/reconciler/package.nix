# Owns the stdlib-only reconciler build and its fake-only state-machine specs.
{
  crystal,
  lib,
}:
crystal.buildCrystalPackage {
  pname = "hjem-services-reconcile";
  version = "1";
  # The sources and specs, so editing this file does not rebuild the binary.
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.difference ./. ./package.nix;
  };
  format = "crystal";
  crystalBinaries.hjem-services-reconcile.src = "main.cr";
  doCheck = true;
  doInstallCheck = true;
}
