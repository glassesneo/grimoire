{
  inputs,
  denix,
  pkgs,
  system,
  configuration,
}: let
  inherit (pkgs) lib;

  genBundles = genSystem: extraModules:
    (genSystem {
      moduleSystem = "bundles";
      extraArgs = {inherit system;};
      inherit extraModules;
    }).packages;
  evaluate = modules: extraModules:
    genBundles
    (denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules =
        [
          ../../adapters/bundles.nix
        ]
        ++ modules;
    }).genSystem
    extraModules;

  feature = {delib, ...}:
    delib.module {
      name = "fixture";
      options.enable = delib.boolOption true;
      bundles.always = {
        unconditional = {
          package = pkgs.hello;
          publish = true;
        };
        private.package = pkgs.hello;
        incomplete = {};
      };
      bundles.ifEnabled.selected = {
        package = pkgs.hello;
        publish = true;
      };
      bundles.ifDisabled = {pkgs, ...}: {
        fallback = {
          package = pkgs.zsh;
          publish = true;
        };
      };
    };

  drvPaths = lib.mapAttrs (_: package: package.drvPath);
  succeeds = result: (builtins.tryEval (builtins.deepSeq (drvPaths result) true)).success;

  assertionResult = assertion:
    genBundles
    (configuration.extendModules {
      modules = [
        ({delib, ...}:
          delib.module {
            name = "constraint-probe";
            meta.description = "Declare one constraint.";
            constraints.always = [
              {
                inherit assertion;
                message = "Bundle constraint probe";
              }
            ];
          })
      ];
    }).genSystem [];
in {
  cases = {
    enabled-module-publishes-always-and-if-enabled = {
      protects = "the bundles adapter publishes an enabled module's always and ifEnabled sections and omits unpublished entries without forcing their packages";
      expr = drvPaths (evaluate [feature] []);
      expected = {
        selected = pkgs.hello.drvPath;
        unconditional = pkgs.hello.drvPath;
      };
    };
    disabled-module-publishes-always-and-if-disabled = {
      protects = "the bundles adapter publishes a disabled module's always and ifDisabled sections, including a function section, and omits unpublished entries without forcing their packages";
      expr = drvPaths (evaluate [feature] [{myconfig.fixture.enable = false;}]);
      expected = {
        fallback = pkgs.zsh.drvPath;
        unconditional = pkgs.hello.drvPath;
      };
    };
    satisfied-constraint-publishes = {
      protects = "a satisfied constraint in the real configuration leaves the published bundle result usable";
      expr = succeeds (assertionResult true);
      expected = true;
    };
    failed-constraint-blocks-bundles = {
      protects = "a failed constraint in the real configuration blocks the whole published bundle result";
      expr = drvPaths (assertionResult false);
      fails = true;
    };
    published-bundle-without-package-fails = {
      protects = "a bundle published without a package fails when its packages are consumed";
      expr = drvPaths (evaluate [
        ({delib, ...}:
          delib.module {
            name = "missing-package";
            bundles.always.missing.publish = true;
          })
      ] []);
      fails = true;
    };
  };
}
