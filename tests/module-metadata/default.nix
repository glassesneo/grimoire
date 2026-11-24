{
  inputs,
  denix,
  pkgs,
}: let
  inherit (pkgs) lib;

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
in {
  cases = {
    described-module-and-undescribed-host-accepted = {
      protects = "the metadata extension accepts a disabled module with a description and requires none from hosts";
      expr = evaluate {meta.description = "Owns the fixture responsibility.";};
      expected = false;
    };
    missing-description-fails = {
      protects = "the metadata extension rejects a module without a description, even while it is disabled";
      expr = evaluate {};
      fails = true;
    };
    empty-description-fails = {
      protects = "the metadata extension rejects an empty module description";
      expr = evaluate {meta.description = "";};
      fails = true;
    };
    blank-description-fails = {
      protects = "the metadata extension rejects a module description of whitespace only";
      expr = evaluate {meta.description = " \t\n\r";};
      fails = true;
    };
    non-string-description-fails = {
      protects = "the metadata extension rejects a module description that is not a string";
      expr = evaluate {meta.description = 42;};
      fails = true;
    };
  };
}
