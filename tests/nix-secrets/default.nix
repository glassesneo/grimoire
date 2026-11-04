{
  inputs,
  pkgs,
}: let
  inherit (pkgs) lib;
  scripts = lib.fileset.toSource {
    root = ../../scripts;
    fileset = lib.fileset.unions [../../scripts/nix-secrets-smoke.nu ../../scripts/run.nu];
  };
  fixtureArgs = {
    inherit inputs;
    username = "fixture";
    homeDirectory = "/tmp/nix-secrets-fixture";
  };
  inherit (import ./fixture.nix fixtureArgs) evaluate;
  enabled = automatic: extraPackages:
    import ./fixture.nix (fixtureArgs
      // {
        extraModules = [
          {
            security.nix-secrets = {
              activate.enable = automatic;
              defaultGroup = 20;
              inherit extraPackages;
            };
          }
        ];
      });
  fixture = enabled true [pkgs.coreutils];
  on = fixture.result;
  off = evaluate [];
  manual = (enabled false []).result;
  defaults = (enabled true []).result;
  production = evaluate [
    {
      security.nix-secrets = {
        enable = true;
        installPackage = false;
        storage = "/tmp/nix-secrets-fixture/storage";
        secrets.dummy = {};
      };
    }
  ];
  source = result: name: (lib.findFirst (file: lib.hasSuffix "/${name}" file.target) (throw "Missing fixture output ${name}") result.manifest.files).source;
  # writeText's evaluation-time text avoids reading generated files (IFD).
  json = result: name: builtins.fromJSON (builtins.unsafeDiscardStringContext (source result name).text);
  manifest = source on "manifest.json";
  environment = json on "cli-env.json";
  wiring = json on "wiring.json";
  activationManifest = pkgs.writeText "nix-secrets-manifest.json" manifest.text;
  package = builtins.appendContext wiring.package (builtins.getContext (source on "wiring.json").text);
  automaticJob = builtins.head on.apply.steps.services.jobs;
  productionJob = builtins.head production.apply.steps.services.jobs;
  scriptWiring = result: path: let
    values = json result "wiring.json";
  in
    lib.drop 4 (builtins.head result.apply.steps.services.jobs).config.ProgramArguments
    == [values.activateScript]
    && lib.all (line: lib.elem line (lib.splitString "\n" values.script)) [
      "export HOME=${lib.escapeShellArg "/tmp/nix-secrets-fixture"}"
      "export PATH=${lib.escapeShellArg path}"
      "mkdir -p ${lib.escapeShellArg "${values.stateDirectory}/nix-secrets"}"
      "exec /usr/bin/lockf -k ${lib.escapeShellArg "${values.stateDirectory}/nix-secrets/activate.lock"} ${values.command}"
    ];
in {
  platforms = lib.platforms.darwin;
  check =
    # Keep static compatibility wiring at evaluation: disabled/manual jobs,
    # manifest/CLI commands and activation argv. Hjem owns generic lowering.
    # Shell-only HOME/PATH/lock wiring uses evaluated text, not source regexes.
    assert off.apply.steps.services.jobs == [];
    assert manual.apply.steps.services.jobs == [];
    assert builtins.length on.apply.steps.services.jobs == 1;
    assert automaticJob.domain == "gui" && automaticJob.restart && automaticJob.runAtLoad;
    assert automaticJob.label == "org.hjem.nix-secrets-probe";
    assert automaticJob.config.Label == automaticJob.label;
    assert builtins.length production.apply.steps.services.jobs == 1;
    assert productionJob.label == "org.hjem.nix-secrets-activate";
    assert productionJob.label != automaticJob.label;
    assert wiring.command == "${wiring.package}/bin/nix-secrets activate ${activationManifest} --needed-for-users false";
    assert environment.NIX_SECRETS_NIX_EVAL_COMMAND == "${pkgs.coreutils}/bin/cat ${activationManifest}";
    assert environment.NIX_SECRETS_GENERATOR_BUILD_COMMAND == "${pkgs.nix}/bin/nix-store --realise {{input}}";
    assert builtins.length (json on "manifest.json").secrets == 1;
    assert scriptWiring on "${pkgs.coreutils}/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    assert scriptWiring defaults "/usr/bin:/bin:/usr/sbin:/sbin";
      pkgs.runCommand "nix-secrets-wiring-test" {
        meta.platforms = lib.platforms.darwin;
        nativeBuildInputs = [pkgs.nushell];
      } ''
        nu --no-config-file -c 'use std/assert; assert (nu-check --debug ${scripts}/nix-secrets-smoke.nu)'
        nu --no-config-file ${./test.nu} ${manifest} ${source on "cli-env.json"} ${fixture.probe} ${package}/bin/nix-secrets
        touch "$out"
      '';
}
