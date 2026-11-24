{
  crystal,
  lib,
}:
crystal.buildCrystalPackage {
  pname = "hjem-defaults-reconcile";
  version = "1";
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
