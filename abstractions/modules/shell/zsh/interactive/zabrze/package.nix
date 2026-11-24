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
