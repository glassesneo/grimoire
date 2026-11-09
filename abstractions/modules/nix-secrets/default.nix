# Owns standalone Hjem compatibility and Darwin activation for upstream
# nix-secrets. Secrets remain upstream options; registration does not imply
# consumer readiness. The default Darwin package verifies RAM backing before
# placing plaintext files.
{
  delib,
  inputs,
  ...
}:
delib.module {
  name = "nix-secrets";
  meta.description = "Provide nix-secrets to Hjem and activate its secrets on Darwin.";

  hjem.always = {
    config,
    lib,
    pkgs,
    ...
  }: let
    cfg = config.security.nix-secrets;
    lockDir = "${config.xdg.state.directory}/nix-secrets";
    # Several triggers can start activation together, and upstream activation has no lock.
    activate = pkgs.writeShellScript "nix-secrets-activate" ''
      set -eu
      export HOME=${lib.escapeShellArg config.directory}
      export PATH=${lib.escapeShellArg "${lib.optionalString (cfg.extraPackages != []) "${lib.makeBinPath cfg.extraPackages}:"}/usr/bin:/bin:/usr/sbin:/sbin"}
      mkdir -p ${lib.escapeShellArg lockDir}
      exec /usr/bin/lockf -k ${lib.escapeShellArg "${lockDir}/activate.lock"} ${cfg.activate.command false}
    '';
  in {
    options.security.nix-secrets.activateScript = lib.mkOption {
      type = lib.types.path;
      readOnly = true;
      description = "Darwin activation command, serialized with every other trigger that runs it.";
    };

    imports = [inputs.nix-secrets.hjemModules.default];
    # Upstream defines systemd options even when automatic activation is disabled.
    disabledModules = ["${inputs.nix-secrets}/nix/hjem/activate/systemd.nix"];

    config = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin (lib.mkMerge [
      {
        security.nix-secrets = {
          defaultGroup = lib.mkDefault "staff";
          package = lib.mkDefault ((pkgs.callPackage "${inputs.nix-secrets}/package.nix" {}).overrideAttrs (old: {
            patches =
              (old.patches or [])
              ++ [
                ./nix-secrets-darwin-anchor.patch
                ./nix-secrets-darwin-ram.patch
              ];
          }));
        };
      }
      (lib.mkIf cfg.enable {
        security.nix-secrets = {
          activateScript = activate;
          # CLI lookup uses this Hjem user's generated manifest regardless of
          # --flake; override nixEvalCommand to target another configuration.
          nixEvalCommand = lib.mkDefault "${pkgs.coreutils}/bin/cat ${pkgs.writeText "nix-secrets-manifest.json" cfg.manifest}";
          generatorBuildCommand = lib.mkDefault "${pkgs.nix}/bin/nix-store --realise {{input}}";
        };
      })
      (lib.mkIf (cfg.enable && cfg.activate.enable) {
        # The RAM disk is gone after a reboot; the login group activates
        # secrets when dinit starts with each GUI login. dinit also restarts
        # the service when a switch changes its command, so a manifest change
        # activates twice under a GUI session; the lock serializes the runs.
        userServices.nix-secrets-activate = {
          type = "scripted";
          command = ["${activate}"];
          restart = "never";
          logFile = "${config.directory}/Library/Logs/nix-secrets-activate.log";
        };
        # Every switch activates the current manifest, also without a GUI
        # session, where dinit does not run. No step relies on secrets: a
        # service that reads them depends on the activation service in dinit.
        applySteps.nix-secrets.package = pkgs.linkFarm "hjem-nix-secrets" {"bin/apply" = activate;};
      })
    ]);
  };

  # The cases observe the wiring that no published host varies: disabled and
  # manual activation, the probe's own job and switch step, the CLI commands,
  # and the activation script's environment. The build runs the package this
  # module patches against the probe's manifest without launchd or mounts.
  tests.fixture = ["services"];
  tests.cases = {
    pkgs,
    lib,
    home,
    ...
  }: let
    probe = import ./probe.nix;
    # The probe with `settings` added to its Hjem configuration.
    probed = settings: {
      hjem.always.imports = [(probe.module home) {security.nix-secrets = settings;}];
    };
    case = attrs:
      {
        platforms = ["aarch64-darwin"];
      }
      // attrs;
    jobs = result: result.apply.steps.services.services;
    activates = result: result.apply.steps ? nix-secrets;
    source = result: name: (lib.findFirst (file: lib.hasSuffix "/${name}" file.target) (throw "Missing fixture output ${name}") result.manifest.files).source;
    # writeText's evaluation-time text avoids reading generated files (IFD).
    json = result: name: builtins.fromJSON (builtins.unsafeDiscardStringContext (source result name).text);
    automatic = extraPackages:
      probed {
        activate.enable = true;
        defaultGroup = 20;
        inherit extraPackages;
      };
    # The activation job runs the activation script, which sets HOME and PATH
    # and serializes runs under the state directory's lock.
    scriptWiring = path: result: let
      values = json result "wiring.json";
    in
      (builtins.head (jobs result)).command
      == [values.activateScript]
      && lib.all (line: lib.elem line (lib.splitString "\n" values.script)) [
        "export HOME=${lib.escapeShellArg home}"
        "export PATH=${lib.escapeShellArg path}"
        "mkdir -p ${lib.escapeShellArg "${values.stateDirectory}/nix-secrets"}"
        "exec /usr/bin/lockf -k ${lib.escapeShellArg "${values.stateDirectory}/nix-secrets/activate.lock"} ${values.command}"
      ];
  in {
    disabled-registers-no-job = case {
      protects = "Without `security.nix-secrets.enable`, the module registers no activation service or switch step.";
      expr = result: {
        jobs = jobs result;
        step = activates result;
      };
      expected = {
        jobs = [];
        step = false;
      };
    };
    manual-activation-registers-no-job = case {
      protects = "With `activate.enable = false`, secrets are activated only on demand, so no service or switch step is registered.";
      modules.probe = probed {activate.enable = false;};
      expr = result: {
        jobs = jobs result;
        step = activates result;
      };
      expected = {
        jobs = [];
        step = false;
      };
    };
    automatic-activation-job = case {
      protects = "Automatic activation registers one scripted service that starts with each dinit instance, and a switch step that activates on every switch whether dinit runs or not, instead of dinit rerunning the service.";
      modules.probe = automatic [pkgs.coreutils];
      expr = result: let
        job = builtins.head (jobs result);
      in {
        count = builtins.length (jobs result);
        inherit (job) type automatic restartOnSwitch;
        step = activates result;
      };
      expected = {
        count = 1;
        type = "scripted";
        automatic = true;
        restartOnSwitch = false;
        step = true;
      };
    };
    cli-commands = case {
      protects = "Activation and the CLI read this Hjem user's generated manifest, and generators are realized with nix-store.";
      modules.probe = automatic [pkgs.coreutils];
      expr = result: let
        wiring = json result "wiring.json";
        environment = json result "cli-env.json";
        manifest = pkgs.writeText "nix-secrets-manifest.json" (source result "manifest.json").text;
      in {
        command = wiring.command == "${wiring.package}/bin/nix-secrets activate ${manifest} --needed-for-users false";
        eval = environment.NIX_SECRETS_NIX_EVAL_COMMAND == "${pkgs.coreutils}/bin/cat ${manifest}";
        generator = environment.NIX_SECRETS_GENERATOR_BUILD_COMMAND;
        secrets = builtins.length (json result "manifest.json").secrets;
      };
      expected = {
        command = true;
        eval = true;
        generator = "${pkgs.nix}/bin/nix-store --realise {{input}}";
        secrets = 1;
      };
    };
    activation-script-extra-packages = case {
      protects = "The activation script's PATH puts `extraPackages` before the system directories.";
      modules.probe = automatic [pkgs.coreutils];
      expr = scriptWiring "${pkgs.coreutils}/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      expected = true;
    };
    activation-script-default-path = case {
      protects = "Without `extraPackages`, the activation script's PATH holds only the system directories.";
      modules.probe = automatic [];
      expr = scriptWiring "/usr/bin:/bin:/usr/sbin:/sbin";
      expected = true;
    };
    package-execution = case {
      protects = "The CLI's manifest lookup returns the generated manifest, and the patched package publishes no plaintext on a missing key or a forged RAM-disk anchor; the live check's script parses.";
      modules.probe = automatic [pkgs.coreutils];
      build = result: let
        wiring = json result "wiring.json";
        package = builtins.appendContext wiring.package (builtins.getContext (source result "wiring.json").text);
        manifest = pkgs.writeText "nix-secrets-manifest.json" (source result "manifest.json").text;
        scripts = lib.fileset.toSource {
          root = ../../../scripts;
          fileset = lib.fileset.unions [../../../scripts/nix-secrets-smoke.nu ../../../scripts/run.nu];
        };
      in
        pkgs.runCommand "nix-secrets-package-execution" {
          nativeBuildInputs = [pkgs.nushell];
        } ''
          nu --no-config-file -c 'use std/assert; assert (nu-check --debug ${scripts}/nix-secrets-smoke.nu)'
          nu --no-config-file ${./test.nu} ${manifest} ${source result "cli-env.json"} ${probe.farm pkgs result} ${package}/bin/nix-secrets
          touch "$out"
        '';
    };
  };
}
