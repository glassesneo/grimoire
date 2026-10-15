# Type-checks quin, the clients, and tests/shield against quin's tsconfig, then
# runs the published quin. The package build runs only quin's Bun tests.
{
  inputs,
  pkgs,
  system,
}: let
  quin = inputs.self.packages.${system}.quin or null;
  bun2nix = inputs.bun2nix.packages.${system}.default;
  shield = ../../abstractions/modules/agents/shield;
in
  bun2nix.mkDerivation {
    pname = "quin-check";
    version = "0.1.0";
    src = pkgs.lib.fileset.toSource {
      root = ../..;
      fileset = pkgs.lib.fileset.unions [(shield + "/quin") (shield + "/client") ../shield];
    };
    bunDeps = quin.bunDeps;
    postUnpack = ''
      cp "$sourceRoot/abstractions/modules/agents/shield/quin/package.json" "$sourceRoot/package.json"
      cp "$sourceRoot/abstractions/modules/agents/shield/quin/bun.lock" "$sourceRoot/bun.lock"
    '';
    nativeBuildInputs = [quin];
    buildPhase = ''
      bun node_modules/typescript/bin/tsc -p abstractions/modules/agents/shield/quin
      quin --version
      quin --help
      HOME="$TMPDIR" quin --check-keymap
    '';
    installPhase = ''
      touch "$out"
    '';
    meta.platforms =
      if quin == null
      then []
      else quin.meta.platforms;
  }
