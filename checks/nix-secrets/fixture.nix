# Shared isolated fixture: sandboxed wiring checks and explicit live activation.
# Composes the Hjem adapter with the nix-secrets module and the services module
# it registers activation with; `evaluate` adds Hjem modules to that fixture.
{
  inputs,
  homeDirectory,
  username,
  extraModules ? [],
}: let
  inherit (inputs.nixpkgs) lib;
  pkgs = inputs.nixpkgs.legacyPackages.aarch64-darwin;
  evaluate = modules:
    (inputs.denix.lib.denixConfiguration {
      extraInputs = inputs;
      specialArgs.mylib = import ../../lib {inherit lib;};
      modules = [
        inputs.denix.denixModules.nixDarwin
        ../../adapters/hjem
        ../../adapters/bundles.nix
        ../../extensions/hosts.nix
        ../../extensions/module-metadata.nix
        ../../extensions/module-tests.nix
        ../../extensions/provenance.nix
        ../../abstractions/modules/services/default.nix
        ../../abstractions/modules/nix-secrets/default.nix
        ({delib, ...}:
          delib.host {
            name = "fixture";
            system = "aarch64-darwin";
            user = {
              name = username;
              inherit homeDirectory;
            };
            hjem.always = modules;
          })
      ];
    }).genSystem {
      moduleSystem = "hjem";
      host = "fixture";
      extraArgs = {
        system = "aarch64-darwin";
        inherit username homeDirectory;
      };
    };
  result = evaluate ([
      ({
        config,
        lib,
        ...
      }: let
        cfg = config.security.nix-secrets;
      in {
        security.nix-secrets = {
          enable = lib.mkDefault true;
          installPackage = false;
          storage = "${homeDirectory}/storage";
          identityPaths = ["${homeDirectory}/key.txt"];
          baseDir = "${homeDirectory}/activated";
          generationsDir = "${homeDirectory}/generations";
          secrets.dummy = {};
        };
        platform.darwin.launchAgents = lib.mkIf (cfg.enable && cfg.activate.enable) {
          nix-secrets-activate.config.Label = lib.mkForce "org.hjem.nix-secrets-probe";
        };
        files = {
          "manifest.json".text = cfg.manifest;
          "cli-env.json".text = builtins.toJSON config.environment.sessionVariables;
          "wiring.json".text = builtins.toJSON {
            command = cfg.activate.command false;
            script = cfg.activateScript.text;
            activateScript = toString cfg.activateScript;
            package = toString cfg.package;
            stateDirectory = config.xdg.state.directory;
          };
          "secret-path".text = cfg.secrets.dummy.path;
          "activate".source = pkgs.writeShellScript "probe-activate" ''
            export PATH=/usr/bin:/bin:/usr/sbin:/sbin
            exec ${cfg.activate.command false}
          '';
          "keygen".source = pkgs.writeShellScript "probe-keygen" ''
            exec ${cfg.package}/bin/nix-secrets keygen "$@"
          '';
          "age".source = "${pkgs.age}/bin/age";
        };
      })
    ]
    ++ extraModules);
in {
  inherit evaluate result;
  probe = pkgs.linkFarm "nix-secrets-probe" (
    map (file: {
      name = builtins.baseNameOf file.target;
      path = file.source;
    })
    result.manifest.files
    ++ [
      {
        name = "services";
        path = result.apply.steps.services;
      }
    ]
  );
}
