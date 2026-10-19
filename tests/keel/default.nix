# Type-checks and lints keel, the SHIELD clients, and the process scripts against keel's
# tsconfig and the repository's .oxlintrc.json; checks keel's own extensions for Pi's
# standard UI and that the check finds it; then runs the published keel. The package build
# runs keel's Bun tests.
{
  inputs,
  pkgs,
  system,
}: let
  keel = inputs.self.packages.${system}.keel or null;
  bun2nix = inputs.bun2nix.packages.${system}.default;
  agents = ../../abstractions/modules/agents;
  # Directories, relative to the repository, that the type check and lint cover.
  tsRoots = ["abstractions/modules/agents/keel" "abstractions/modules/agents/shield/client" "tests/shield-process"];
in
  bun2nix.mkDerivation {
    pname = "keel-check";
    version = "0.1.0";
    src = pkgs.lib.fileset.toSource {
      root = ../..;
      fileset = pkgs.lib.fileset.unions [
        ../../.oxlintrc.json
        (pkgs.lib.fileset.difference (agents + "/keel") (agents + "/keel/bun.nix"))
        (agents + "/shield/client")
        ../shield-process
      ];
    };
    bunDeps = keel.bunDeps;
    postUnpack = ''
      cp "$sourceRoot/abstractions/modules/agents/keel/package.json" "$sourceRoot/package.json"
      cp "$sourceRoot/abstractions/modules/agents/keel/bun.lock" "$sourceRoot/bun.lock"
    '';
    nativeBuildInputs = [keel pkgs.oxlint pkgs.tsgolint pkgs.nodejs];
    buildPhase = ''
      bun node_modules/typescript/bin/tsc -p abstractions/modules/agents/keel
      oxlint --deny-warnings ${pkgs.lib.escapeShellArgs tsRoots}
      cd abstractions/modules/agents/keel
      node check-ui.ts extensions/*.ts fixtures/*.ts
      # The check finds a use of ctx.ui, fails on it as an error, and only reports it as a warning.
      cat > extensions/ui-probe.ts <<'PROBE'
      import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
      // ctx.ui.notify("a comment is not a use")
      export default (pi: ExtensionAPI) =>
        pi.on("session_start", (_event, ctx) => ctx.ui.notify("shown nowhere"));
      PROBE
      if node check-ui.ts extensions/ui-probe.ts 2> report; then exit 1; fi
      grep -q 'error: extensions/ui-probe.ts:4:' report
      node check-ui.ts --level warning extensions/ui-probe.ts 2> report
      test "$(grep -c 'warning:' report)" = 1
      rm extensions/ui-probe.ts report
      cd -
      keel --version
      keel --help
    '';
    passthru = {inherit tsRoots;};
    installPhase = ''
      touch "$out"
    '';
    meta.platforms =
      if keel == null
      then []
      else keel.meta.platforms;
  }
