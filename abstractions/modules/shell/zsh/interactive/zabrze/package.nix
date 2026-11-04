# Owns the zabrze build, which nixpkgs does not provide, from the release
# source `zabrze` that the module pins.
{
  lib,
  rustPlatform,
  zabrze,
}:
rustPlatform.buildRustPackage {
  pname = "zabrze";
  version = lib.removePrefix "v" zabrze.version;

  src = zabrze;
  cargoLock.lockFile = "${zabrze}/Cargo.lock";

  # These tests pass EDITOR to `zsh -c`, which the build machine's /etc/zshenv
  # can override on Darwin.
  checkFlags = [
    "--skip=test_evaluate"
    "--skip=test_legacy_yaml"
  ];

  meta = {
    description = "Zsh abbreviation expansion plugin";
    homepage = "https://github.com/Ryooooooga/zabrze";
    license = lib.licenses.mit;
    mainProgram = "zabrze";
  };
}
