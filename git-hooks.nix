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
    fileset = lib.fileset.unions [./scripts/commit.nu ./scripts/docs.nu ./scripts/checks.nu ./scripts/pre-push.nu ./scripts/run.nu ./scripts/snapshot.nu ./scripts/gate.nu];
  };
  runner = pkgs.writeShellApplication {
    name = "repository-hook";
    runtimeInputs = [pkgs.git pkgs.nix pkgs.nushell pkgs.coreutils pkgs.findutils];
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
    runtimeInputs = [pkgs.git pkgs.nix pkgs.nushell pkgs.gnutar pkgs.coreutils pkgs.findutils];
    text = ''
      exec nu --no-config-file --stdin ${scripts}/pre-push.nu
    '';
  };
  directory = pkgs.runCommand "repository-git-hooks" {} ''
    mkdir -p "$out"
    ln -s ${hook} "$out/pre-commit"
    ln -s ${lib.getExe pushHook} "$out/pre-push"
  '';
in {
  inherit directory;
  shellHook = ''
    if ${pkgs.git}/bin/git rev-parse --git-dir >/dev/null 2>&1; then
      hooks_root="$(${pkgs.git}/bin/git rev-parse --path-format=absolute --git-common-dir)/nix-hooks"
      nix-store --add-root "$hooks_root" --indirect --realise ${directory} >/dev/null
      ${pkgs.git}/bin/git config --local core.hooksPath "$hooks_root"
      unset hooks_root
    fi
  '';
}
