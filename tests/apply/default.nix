# The apply procedure, not Nix or SSH, decides when a layer may proceed. Run it
# with fake external commands: a failed build stops before any later stage,
# whether or not the build printed a path, the error names the failed stage, and
# a successful `all` applies nix-darwin before Hjem.
{pkgs, ...}: let
  fake = command:
    pkgs.writeShellScriptBin command ''
      exec ${pkgs.nushell}/bin/nu --no-config-file ${./fake.nu} ${command} "$@"
    '';
in
  pkgs.runCommand "apply" {
    nativeBuildInputs = map fake ["nix" "ssh" "hostname"] ++ [pkgs.nushell];
  } ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    nu --no-config-file ${./test.nu} ${../../scripts/apply.nu}
    touch "$out"
  ''
