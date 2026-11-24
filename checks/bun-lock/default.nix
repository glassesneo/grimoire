{
  inputs,
  pkgs,
  system,
}: let
  inherit (pkgs) lib;
  locks = lib.fileset.toList (lib.fileset.fileFilter (file: file.name == "bun.lock") ../..);
in {
  protects = "every committed bun.nix is what `just bun` writes from the bun.lock beside it";
  check =
    pkgs.runCommand "bun-lock-current" {
      nativeBuildInputs = [inputs.bun2nix.packages.${system}.default];
    } ''
      ${lib.concatMapStrings (lock: ''
          bun2nix --lock-file ${lock} --output-file expected.nix
          diff -u ${dirOf lock + "/bun.nix"} expected.nix
        '')
        locks}
      touch "$out"
    '';
}
