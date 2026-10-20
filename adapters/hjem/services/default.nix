# Owns the stdlib-only reconciler build and its fake-only state-machine specs.
{crystal}:
crystal.buildCrystalPackage {
  pname = "hjem-services-reconcile";
  version = "1";
  src = ./.;
  format = "crystal";
  crystalBinaries.hjem-services-reconcile.src = "main.cr";
  doCheck = true;
  doInstallCheck = true;
}
