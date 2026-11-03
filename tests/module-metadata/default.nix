{
  inputs,
  denix,
  pkgs,
  system,
}: let
  lib = pkgs.lib;

  # Repository-owned boundary: generated modules must reject missing metadata,
  # including on disabled features. Nix types validate strings once forced;
  # this check covers the extension's forcing and its exclusion of hosts.
  # Classification consumers must see declared tags without inheriting parent
  # tags or changing a module's enable default.
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
            (delib.module {
              name = "fixture.child";
              meta.description = "Owns the child fixture responsibility.";
            })
            (delib.host {name = "fixture-host";})
          ];
        })
      ];
    };
    generated = lib.evalModules {
      modules = [(configuration.genModule {})];
    };
  in {
    description = configuration.config.modules.fixture.meta.description;
    tags = configuration.config.modules.fixture.meta.tags;
    childTags = configuration.config.modules."fixture.child".meta.tags;
    enabled = generated.config.myconfig.fixture.enable;
  };

  valid = evaluate {
    meta = {
      description = "Owns the fixture responsibility.";
      tags = ["dev" "editor"];
    };
  };
  accepts = metadata: (builtins.tryEval (evaluate metadata).enabled).success;
in {
  check = assert lib.assertMsg (
    valid.description
    == "Owns the fixture responsibility."
    && valid.enabled == false
  ) "Module descriptions must be accessible, and hosts need no description";
  assert lib.assertMsg (
    valid.tags == ["dev" "editor"] && valid.childTags == []
  ) "Tags must be accessible as module metadata without parent inheritance";
  assert lib.assertMsg (
    !(accepts {})
    && !(accepts {meta.description = "";})
    && !(accepts {meta.description = " \t\n\r";})
    && !(accepts {meta.description = 42;})
  ) "Generated modules must reject missing or invalid descriptions, even when disabled";
    pkgs.runCommand "module-metadata-test" {} ''
      mkdir "$out"
    '';
}
