{
  inputs,
  denix,
  pkgs,
}: let
  inherit (pkgs) lib;

  # Repository-owned boundary: generated modules must reject missing metadata,
  # including on disabled features. Nix types validate strings once forced;
  # this check covers the extension's forcing and its exclusion of hosts.
  evaluate = metadata: let
    configuration = denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules = [
        ../../extensions/module-metadata.nix
        ({delib, ...}: {
          imports = [
            (delib.module ({
                name = "fixture";
                options.enable = delib.boolOption false;
              }
              // metadata))
            (delib.host {name = "fixture-host";})
          ];
        })
      ];
    };
    generated = lib.evalModules {
      modules = [(configuration.genModule {})];
    };
  in
    generated.config.myconfig.fixture.enable;
  accepts = metadata: (builtins.tryEval (evaluate metadata)).success;
in {
  check = assert lib.assertMsg (
    accepts {meta.description = "Owns the fixture responsibility.";}
    && !(accepts {})
    && !(accepts {meta.description = "";})
    && !(accepts {meta.description = " \t\n\r";})
    && !(accepts {meta.description = 42;})
  ) "Generated modules must accept a description and reject a missing or invalid one, even when disabled, while hosts need none";
    pkgs.runCommand "module-metadata-test" {} ''
      mkdir "$out"
    '';
}
