{pkgs, ...}: let
  fake = command:
    pkgs.writeShellScriptBin command ''
      exec ${pkgs.nushell}/bin/nu --no-config-file ${./fake.nu} ${command} "$@"
    '';
in {
  check =
    pkgs.runCommand "apply" {
      nativeBuildInputs = map fake ["nix" "nix-store" "ssh" "hostname"] ++ [pkgs.nushell];
    } ''
      export HOME="$TMPDIR/home"
      mkdir -p "$HOME"
      nu --no-config-file ${./test.nu} ${../../scripts/apply.nu}
      touch "$out"
    '';
}
