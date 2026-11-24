{pkgs, ...}: let
  source = pkgs.lib.fileset.toSource {
    root = ../..;
    fileset = pkgs.lib.fileset.unions [./test.nu ../../scripts/checks.nu];
  };
in {
  protects = "changed paths select the checks of the modules, hosts and check directories that own them, without under-selecting unknown paths";
  check = pkgs.runCommand "selection" {nativeBuildInputs = [pkgs.nushell];} ''
    nu --no-config-file ${source}/tests/selection/test.nu
    touch "$out"
  '';
}
