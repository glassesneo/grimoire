# quin's derivation typechecks, builds, and runs its renderer/key tests.
{
  inputs,
  pkgs,
  system,
}:
pkgs.runCommand "quin-check" {
  nativeBuildInputs = [inputs.self.packages.${system}.quin];
  meta.platforms = ["aarch64-darwin"];
} ''
  quin --version
  quin --help
  touch "$out"
''
