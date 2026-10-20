# Git/pre-commit do not guarantee our auto-staging policy. Exercise real commits
# with a fake Nix executable: pending work stays out of the snapshot and the
# commit, conflicting fixes are refused, fixes enter the commit and worktree, and
# failed validation prevents the commit without discarding staged fixes.
{
  pkgs,
  inputs,
  system,
}: let
  fakeNix = pkgs.writeShellScriptBin "nix" ''
    exec ${pkgs.nushell}/bin/nu --no-config-file ${./fake-nix.nu} "$@"
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
        git = fakeGit;
      };
    git-hooks = inputs.git-hooks;
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
