# quin's derivation typechecks, builds, and runs its renderer/key tests.
{
  inputs,
  pkgs,
  system,
}: let
  quin = inputs.self.packages.${system}.quin or null;
in
  pkgs.runCommand "quin-check" {
    nativeBuildInputs = [quin];
    meta.platforms =
      if quin == null
      then []
      else quin.meta.platforms;
  } ''
    quin --version
    quin --help
    HOME="$TMPDIR" quin --check-keymap
    touch "$out"
  ''
