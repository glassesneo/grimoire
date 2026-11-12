{
  delib,
  lib,
  ...
}:
delib.module {
  name = "pi.input";
  tests.fixture = ["pi"];
  meta.description = "Provide Pi's command palette and stop confirmation.";

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
      protects = "the input extension type-checks and lints against the SDK of the Pi that loads it";
      tsRoots = ["src"];
      build = result:
        typescriptCheck {
          name = "pi-input";
          src = ./src;
          types = result.options.myconfig.pi.sdkTypes.value;
        };
    };
    disabled-parent-contributes-nothing = {
      protects = "the input extension contributes no Pi settings while Pi is disabled";
      host.myconfig.ifEnabled.pi.enable = false;
      expr = result: result.manifest.files;
      expected = [];
    };
    extension-loads = {
      protects = "native palette editing and dispatch preserve the main draft, successful session operations own draft replacement, and stop confirmation respects focus and time, never stops on a held key with or without terminal repeat reports, and also stops a running ! command";
      tsRoots = ["src"];
      build = result:
        pkgs.runCommand "pi-input" {} ''
          export HOME=$TMPDIR/home PI_CODING_AGENT_DIR=$TMPDIR/agent PI_OFFLINE=1 PI_TELEMETRY=0
          mkdir -p "$HOME" "$PI_CODING_AGENT_DIR"
          ${pi result} --offline --no-session --no-skills --no-context-files --no-prompt-templates --no-themes -e ${./src}/policy.test.ts --help > contracts.log 2>&1
          cat contracts.log
          grep -q '^pi-input behavior contracts passed$' contracts.log
          touch "$out"
        '';
    };
  };
}
