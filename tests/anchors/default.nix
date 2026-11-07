{pkgs, ...}: let
  source = pkgs.lib.fileset.toSource {
    root = ../..;
    fileset = pkgs.lib.fileset.unions [./test.nu ../../scripts/anchors.nu ../../scripts/checks.nu];
  };
in {
  check = pkgs.runCommand "anchors" {nativeBuildInputs = [pkgs.nushell];} ''
    nu --no-config-file ${source}/tests/anchors/test.nu
    touch "$out"
  '';
}
