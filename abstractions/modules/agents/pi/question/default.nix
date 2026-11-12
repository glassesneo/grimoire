{
  delib,
  lib,
  ...
}:
delib.module {
  name = "pi.question";
  tests.fixture = ["pi"];
  meta.description = "Ask the user for decisions through Pi's question tool.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.pi.extensions = ["${./src}/extension.ts"];

  tests.cases = {
    pkgs,
    typescriptCheck,
    ...
  }: let
    settings = result: lib.findFirst (file: lib.hasSuffix "/.pi/agent/settings.json" file.target) (throw "missing settings") result.manifest.files;
    pi = result: lib.getExe result.options.myconfig.agents.packages.value.pi;
  in {
    typescript = {
      protects = "the question extension type-checks and lints against the SDK of the Pi that loads it";
      tsRoots = ["src"];
      build = result:
        typescriptCheck {
          name = "pi-question";
          src = ./src;
          types = result.options.myconfig.pi.sdkTypes.value;
        };
    };
    disabled-parent-contributes-nothing = {
      protects = "the question extension contributes no Pi settings while Pi is disabled";
      host.myconfig.ifEnabled.pi.enable = false;
      expr = result: result.manifest.files;
      expected = [];
    };
    disabled-extension-is-omitted = {
      protects = "disabling the question feature removes its entry from the settings Pi writes";
      uses = ["pi.input" "pi.compaction"];
      host.myconfig.ifEnabled = {
        pi.question.enable = false;
      };
      build = result:
        pkgs.runCommand "pi-question-omitted" {nativeBuildInputs = [pkgs.jq];} ''
          jq -e --arg entry '${./src}/extension.ts' '.extensions | index($entry) == null' ${(settings result).source}
          touch "$out"
        '';
    };
    extension-loads-and-renders = {
      protects = "the question extension loads in Pi and its history renderer keeps the confirmed answers or the failure cause on rows ruled apart from model output, and focus alone never adds an option to a submitted answer";
      uses = ["pi.input" "pi.compaction"];
      tsRoots = ["src"];
      build = result:
        pkgs.runCommand "pi-question" {nativeBuildInputs = [pkgs.nodejs pkgs.jq];} ''
          jq -e --arg entry '${./src}/extension.ts' '.extensions | index($entry) != null' ${(settings result).source}
          export HOME=$TMPDIR/home PI_CODING_AGENT_DIR=$TMPDIR/agent PI_OFFLINE=1 PI_TELEMETRY=0
          mkdir -p "$HOME" "$PI_CODING_AGENT_DIR"
          ${pi result} --offline --no-session --no-skills --no-context-files --no-prompt-templates --no-themes -e ${./src}/render.test.ts --help | grep -Fx 'question history contract verified'
          ${pi result} --offline --no-session --no-skills --no-context-files --no-prompt-templates --no-themes -e ${./src}/decision.test.ts --help | grep -Fx 'question decision contract verified'
          ${pi result} --offline --no-session --no-skills --no-context-files --no-prompt-templates --no-themes -e ${./src}/extension.ts --help
          touch "$out"
        '';
    };
  };
}
