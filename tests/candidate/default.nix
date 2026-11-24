{pkgs, ...}: let
  ssh = pkgs.writeShellScriptBin "ssh" ''
    for command; do :; done
    exec sh -c "$command"
  '';
  nix = pkgs.writeShellScriptBin "nix" ''
    case "$1" in
      flake) printf '{"path":"%s"}\n' "$SOURCE" ;;
      copy)
        printf 'copy progress\n'
        test -z "$FAIL_COPY"
        ;;
      *) exit 2 ;;
    esac
  '';
  nixStore = pkgs.writeShellScriptBin "nix-store" ''
    ln -sfn "$4" "$2"
    printf '%s\n' "$2"
  '';
in {
  protects = "pulling a candidate refuses untracked files, keeps the last candidate protected when a transfer fails, and prints only the path";
  check =
    pkgs.runCommand "candidate" {
      nativeBuildInputs = [ssh nix nixStore pkgs.git pkgs.nushell];
    } ''
      export XDG_STATE_HOME="$TMPDIR/state"
      nu --no-config-file ${./test.nu} ${../../scripts/candidate.nu}
      touch "$out"
    '';
}
