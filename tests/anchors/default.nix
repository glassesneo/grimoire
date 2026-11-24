{pkgs, ...}: let
  source = pkgs.lib.fileset.toSource {
    root = ../..;
    fileset = pkgs.lib.fileset.unions [./test.nu ../../scripts/anchors.nu ../../scripts/checks.nu];
  };
in {
  protects = "the anchors commands decide which module a lock file belongs to and which pins an update moved, which npins and the check metadata do not";
  check = pkgs.runCommand "anchors" {nativeBuildInputs = [pkgs.nushell];} ''
    nu --no-config-file ${source}/tests/anchors/test.nu
    touch "$out"
  '';
}
