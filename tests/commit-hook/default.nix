# Git and prek do not guarantee our auto-staging policy or push gate. Exercise
# real commits and pushes with fake Nix and nix-fast-build executables: pending
# work stays out of the snapshot and the commit, conflicting fixes are refused,
# fixes enter the commit and worktree, failed or incomplete validation prevents
# the commit without discarding staged fixes, and the push gate builds every
# check of each distinct sent tree.
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
