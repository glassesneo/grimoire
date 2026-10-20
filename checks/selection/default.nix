{pkgs, ...}: let
  source = pkgs.lib.fileset.toSource {
    root = ../..;
    fileset = pkgs.lib.fileset.unions [./test.nu ../../scripts/checks.nu];
  };
in {
  check = pkgs.runCommand "selection" {nativeBuildInputs = [pkgs.nushell];} ''
    nu --no-config-file ${source}/checks/selection/test.nu
    touch "$out"
  '';
}
