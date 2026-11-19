# Owns commit/push automation and its installation. prek runs the commit hook on
# all files, so it never stashes: the repository hook isolates the index itself
# and writes fixes to the worktree.
{
  pkgs,
  git-hooks,
  system,
  src,
}: let
  inherit (pkgs) lib;
  # Only the scripts the hooks run, so editing another script keeps the hooks.
  scripts = lib.fileset.toSource {
    root = ./scripts;
    fileset = lib.fileset.unions [./scripts/commit.nu ./scripts/docs.nu ./scripts/checks.nu ./scripts/pre-push.nu ./scripts/run.nu ./scripts/gate.nu];
  };
  runner = pkgs.writeShellApplication {
    name = "repository-hook";
    runtimeInputs = [pkgs.git pkgs.nix pkgs.nix-fast-build pkgs.nushell];
    text = ''
      exec nu --no-config-file ${scripts}/commit.nu
    '';
  };
  hooks = git-hooks.lib.${system}.run {
    inherit src;
    package = pkgs.prek;
    install.enable = false;
    hooks.repository = {
      enable = true;
      entry = lib.getExe runner;
      pass_filenames = false;
      always_run = true;
      verbose = true;
    };
  };
  hook = pkgs.writeShellScript "pre-commit" ''
    export PATH=${lib.makeBinPath [pkgs.git]}:$PATH
    exec ${lib.getExe hooks.config.package} run --all-files --config ${hooks.config.configFile}
  '';
  pushHook = pkgs.writeShellApplication {
    name = "pre-push";
    runtimeInputs = [pkgs.git pkgs.nix pkgs.nix-fast-build pkgs.nushell pkgs.gnutar];
    text = ''
      exec nu --no-config-file --stdin ${scripts}/pre-push.nu
    '';
  };
  directory = pkgs.linkFarm "repository-git-hooks" {
    pre-commit = hook;
    pre-push = lib.getExe pushHook;
  };
in {
  inherit directory;
  # The hooks path names the store directory itself, so the Git directory
  # holds no link to the store; Claude Code's sandbox moves aside such links
  # when they appear during a session. The GC root lives in the main
  # worktree's ignored `.direnv/`, shared by every worktree like the hooks path.
  shellHook = ''
    if common_dir="$(${pkgs.git}/bin/git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
      hooks_root="$(dirname "$common_dir")/.direnv/nix-hooks"
      mkdir -p "$(dirname "$hooks_root")"
      nix-store --add-root "$hooks_root" --indirect --realise ${directory} >/dev/null
      ${pkgs.git}/bin/git config --local core.hooksPath ${directory}
      # The former GC root inside the Git directory.
      if [ -L "$common_dir/nix-hooks" ]; then rm -f "$common_dir/nix-hooks"; fi
      unset common_dir hooks_root
    fi
  '';
}
