{
  pkgs,
  inputs,
  system,
}: let
  fakeNix = pkgs.writeShellScriptBin "nix" ''
    exec ${pkgs.nushell}/bin/nu --no-config-file ${./fake-nix.nu} "$@"
  '';
  fakeFastBuild = pkgs.writeShellScriptBin "nix-fast-build" ''
    exec ${pkgs.nushell}/bin/nu --no-config-file ${./fake-nix.nu} fast-build "$@"
  '';
  fakeGit = pkgs.writeShellScriptBin "git" ''
    if [ -n "''${FAIL_ARCHIVE:-}" ] && [ "$1" = archive ]; then
      for argument in "$@"; do
        case "$argument" in
          *.tar) printf '%s\n' "''${argument%.tar}" >> "$SNAPSHOTS" ;;
        esac
      done
      exit 1
    fi
    exec ${pkgs.git}/bin/git "$@"
  '';
  hooks = import ../../git-hooks.nix {
    pkgs =
      pkgs
      // {
        nix = fakeNix;
        nix-fast-build = fakeFastBuild;
        git = fakeGit;
      };
    inherit (inputs) git-hooks;
    inherit system;
    src = ../..;
  };
in {
  protects = "the commit hook keeps pending work out of the snapshot, refuses fixes that would overwrite it, stages fixes, rejects a commit whose checks fail or go unreported, and the push gate builds every check of each sent tree";
  check =
    pkgs.runCommand "commit-hook" {
      nativeBuildInputs = [pkgs.git pkgs.nushell];
    } ''
      export HOME="$TMPDIR/home"
      mkdir -p "$HOME"
      nu --no-config-file ${./test.nu} ${hooks.directory}
      touch "$out"
    '';
}
