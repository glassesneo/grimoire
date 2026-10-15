# Type-checks and lints quin, the clients, and the SHIELD test scripts against
# quin's tsconfig and the repository's .oxlintrc.json, then runs the published
# quin. The package build runs only quin's Bun tests.
{
  inputs,
  pkgs,
  system,
}: let
  quin = inputs.self.packages.${system}.quin or null;
  bun2nix = inputs.bun2nix.packages.${system}.default;
  shield = ../../abstractions/modules/agents/shield;
  # Directories, relative to the repository, that the type check and lint cover.
  tsRoots = ["abstractions/modules/agents/shield/quin" "abstractions/modules/agents/shield/client" "tests/shield-process" "tests/shield-trace"];
in
  bun2nix.mkDerivation {
    pname = "quin-check";
    version = "0.1.0";
    src = pkgs.lib.fileset.toSource {
      root = ../..;
      fileset = pkgs.lib.fileset.unions [../../.oxlintrc.json (shield + "/quin") (shield + "/client") ../shield-process ../shield-trace];
    };
    bunDeps = quin.bunDeps;
    postUnpack = ''
      cp "$sourceRoot/abstractions/modules/agents/shield/quin/package.json" "$sourceRoot/package.json"
      cp "$sourceRoot/abstractions/modules/agents/shield/quin/bun.lock" "$sourceRoot/bun.lock"
    '';
    nativeBuildInputs = [quin pkgs.oxlint pkgs.tsgolint];
    buildPhase = ''
      bun node_modules/typescript/bin/tsc -p abstractions/modules/agents/shield/quin
      oxlint --deny-warnings ${pkgs.lib.escapeShellArgs tsRoots}
      quin --version
      quin --help
      HOME="$TMPDIR" quin --check-keymap
    '';
    passthru = {inherit tsRoots;};
    installPhase = ''
      touch "$out"
    '';
    meta.platforms =
      if quin == null
      then []
      else quin.meta.platforms;
  }
