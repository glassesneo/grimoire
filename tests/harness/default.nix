# Lints the harness against the repository's .oxlintrc.json, with type
# information from its own dependencies, and builds the published harness so
# its type check and install check run with the other checks.
{
  inputs,
  pkgs,
  system,
}: let
  harness = inputs.self.packages.${system}.harness;
  bun2nix = inputs.bun2nix.packages.${system}.default;
  dir = ../../abstractions/modules/agents/harness;
  # Directories, relative to the repository, that the type check and lint cover.
  tsRoots = ["abstractions/modules/agents/harness"];
in
  bun2nix.mkDerivation {
    pname = "harness-check";
    version = "0.0.0";
    src = pkgs.lib.fileset.toSource {
      root = ../..;
      fileset = pkgs.lib.fileset.unions [
        ../../.oxlintrc.json
        (dir + "/package.json")
        (dir + "/bun.lock")
        (dir + "/tsconfig.json")
        (dir + "/build.ts")
        (dir + "/src")
      ];
    };
    bunDeps = harness.bunDeps;
    postUnpack = ''
      cp "$sourceRoot/abstractions/modules/agents/harness/package.json" "$sourceRoot/package.json"
      cp "$sourceRoot/abstractions/modules/agents/harness/bun.lock" "$sourceRoot/bun.lock"
    '';
    nativeBuildInputs = [harness pkgs.oxlint pkgs.tsgolint];
    buildPhase = ''
      oxlint --deny-warnings ${pkgs.lib.escapeShellArgs tsRoots}
    '';
    passthru = {inherit tsRoots;};
    installPhase = ''
      touch "$out"
    '';
  }
