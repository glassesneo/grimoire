# Type/lint coverage includes every TS/TSX file in shield. UI probes verify the
# detector as well as the shipped extensions; the package already runs Bun tests.
{
  pkgs,
  oxlintConfig,
  bun2nix,
  keel,
}:
bun2nix.mkDerivation {
  pname = "keel-check";
  version = "0.1.0";
  src = pkgs.lib.fileset.toSource {
    root = ./..;
    fileset = pkgs.lib.fileset.unions [
      ../package.json
      ../bun.lock
      ../bunfig.toml
      ../tsconfig.json
      ../contracts/cases.json
      ../contracts/state.json
      (pkgs.lib.fileset.fileFilter (file: pkgs.lib.any file.hasExt ["ts" "tsx" "js" "jsx" "mjs" "cjs"]) ./..)
    ];
  };
  bunDeps = keel.bunDeps;
  nativeBuildInputs = [keel pkgs.oxlint pkgs.tsgolint pkgs.nodejs];
  buildPhase = ''
    bun node_modules/typescript/bin/tsc -p .
    oxlint --config ${oxlintConfig} --ignore-pattern 'node_modules/**' --ignore-pattern 'dist/**' --deny-warnings .
    cd keel
    node check-ui.ts --project ../tsconfig.json extensions/*.ts fixtures/*.ts
    # The probe must fail as an error and report exactly one warning otherwise.
    cat > extensions/ui-probe.ts <<'PROBE'
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
    // ctx.ui.notify("a comment is not a use")
    export default (pi: ExtensionAPI) =>
      pi.on("session_start", (_event, ctx) => ctx.ui.notify("shown nowhere"));
    PROBE
    if node check-ui.ts --project ../tsconfig.json extensions/ui-probe.ts 2> report; then exit 1; fi
    grep -q 'error: extensions/ui-probe.ts:4:' report
    node check-ui.ts --project ../tsconfig.json --level warning extensions/ui-probe.ts 2> report
    test "$(grep -c 'warning:' report)" = 1
    rm extensions/ui-probe.ts report
    keel --version
    keel --help
  '';
  installPhase = ''touch "$out"'';
}
