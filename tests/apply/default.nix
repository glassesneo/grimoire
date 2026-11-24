{pkgs, ...}: let
  fake = command:
    pkgs.writeShellScriptBin command ''
      exec ${pkgs.nushell}/bin/nu --no-config-file ${./fake.nu} ${command} "$@"
    '';
in {
  protects = "the apply procedure stops before any later stage when a build fails, names the failed stage, and applies nix-darwin before Hjem from one source";
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
