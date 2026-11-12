{
  delib,
  lib,
  ...
}:
delib.module {
  name = "pi.compaction";
  tests.fixture = ["pi"];
  meta.description = "Compact Pi conversations through the public Responses API.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.pi.extensions = ["${./src}/index.ts"];

  tests.cases = {
    pkgs,
    typescriptCheck,
    ...
  }: let
    pi = result: lib.getExe result.options.myconfig.agents.packages.value.pi;
  in {
    typescript = {
      protects = "the compaction extension type-checks and lints against the SDK of the Pi that loads it";
      tsRoots = ["src"];
      build = result:
        typescriptCheck {
          name = "pi-compaction";
          src = ./src;
          types = result.options.myconfig.pi.sdkTypes.value;
        };
    };
    disabled-parent-contributes-nothing = {
      protects = "the compaction extension contributes no Pi settings while Pi is disabled";
      host.myconfig.ifEnabled.pi.enable = false;
      expr = result: result.manifest.files;
      expected = [];
    };
    extension-loads = {
      protects = "Responses compaction preserves replay and tool/result boundaries across manual compaction and restart, and recovers visibly through Pi standard summaries without losing prior memory";
      tsRoots = ["src"];
      build = result:
        pkgs.runCommand "pi-compaction" {} ''
          export HOME=$TMPDIR/home PI_CODING_AGENT_DIR=$TMPDIR/agent PI_OFFLINE=1 PI_TELEMETRY=0
          export PI_COMPACTION_TEST_OK=$TMPDIR/contracts-passed
          mkdir -p "$HOME" "$PI_CODING_AGENT_DIR"
          ${pi result} --offline --no-session --no-skills --no-context-files --no-prompt-templates --no-themes -e ${./src}/boundary.test.ts --help
          # Pi reports extension-load failures without a nonzero --help exit status.
          test -f "$PI_COMPACTION_TEST_OK"
          touch "$out"
        '';
    };
  };
}
