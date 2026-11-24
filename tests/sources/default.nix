{
  inputs,
  denix,
  pkgs,
  system,
}: let
  inherit (pkgs) lib;
  mylib = import ../../lib {inherit lib;};

  nullable = lib.mkOption {
    type = lib.types.nullOr (lib.types.submodule {
      options = lib.genAttrs ["first" "second"] (_:
        lib.mkOption {
          type = lib.types.str;
          default = "default";
        });
    });
    default = null;
  };

  probe = {delib, ...}:
    delib.module {
      name = "probe";
      options = with delib; {
        enable = boolOption true;
        scalar = strOption "default";
        ricePreferred = strOption "default";
        list = listOfOption str [];
        replacedList = listOfOption str [];
        reports = mylib.accumulatingOption (listOfOption str []);
        reportsByName = mylib.accumulatingOption (attrsOfOption str {});
        forced = strOption "default";
        conditional = strOption "default";
        settings = lib.mkOption {
          inherit (pkgs.formats.keyValue {listsAsDuplicateKeys = true;}) type;
          default = {};
        };
        items = attrsOfOption (submodule {
          options = {
            first = strOption "default";
            second = strOption "default";
          };
        }) {};
        nested = submoduleOption {
          options.inner = submoduleOption {
            options = {
              kept = strOption "default";
              replaced = strOption "default";
            };
          } {};
        } {};
        riceCleared = nullable;
        hostCleared = nullable;
        hostRestored = nullable;
        imported = lib.mkOption {
          type = lib.types.submoduleWith {
            modules = [
              {options = lib.genAttrs ["kept" "riceReplaced" "hostReplaced" "functionImported" "pathImported"] (_: strOption "default");}
              {
                options.reports = listOfOption str [];
                config.reports = ["upstream"];
              }
              {options.reports = mylib.accumulatingOption (lib.mkOption {});}
            ];
          };
          default = {};
        };
        moduleValued = lib.mkOption {
          type = lib.types.submoduleWith {
            modules = [{options.plugins = attrsOfOption str {};}];
          };
          default = {};
        };
        selection = mylib.atomicOption (submoduleOption {
          options = {
            name = strOption "default";
            variant = allowNull (strOption null);
          };
        } {});
      };

      myconfig.always.probe = {
        riceCleared.first = "module";
        hostCleared.first = "module";
        hostRestored.first = "module";
        imported.imports = [
          {
            kept = "module";
            riceReplaced = "module";
            hostReplaced = "module";
          }
          ({lib, ...}: {functionImported = lib.mkIf true "module";})
          {reports = ["module"];}
          ./imported.nix
        ];
        scalar = "module";
        ricePreferred = "module";
        list = ["module"];
        replacedList = ["module"];
        reports = lib.mkIf true ["module"];
        reportsByName.module = "module";
        moduleValued = {lib, ...}: {plugins.module = lib.mkIf true "module";};
        forced = lib.mkForce "module";
        settings = {
          kept = "module";
          replaced = "module";
          keys = ["module"];
        };
        items.entry = {
          first = "module";
          second = "module";
        };
        items.function = {name, ...}: {
          first = "module ${name}";
          second = "module";
        };
        nested.inner = {
          kept = "module";
          replaced = "module";
        };
        selection = {
          name = "module";
          variant = "module";
        };
      };
      myconfig.ifEnabled = {lib, ...}: {
        probe.conditional = lib.mkIf true "module";
      };
    };

  rice = name: value: _:
    mylib.rice {
      inherit name;
      myconfig.probe = value;
    };

  selected = rice "selected" {
    riceCleared = null;
    hostRestored = null;
    imported.riceReplaced = "rice";
    scalar = "rice";
    ricePreferred = "rice";
    list = ["rice"];
    replacedList = ["rice"];
    reports = ["rice"];
    reportsByName.rice = "rice";
    imported.reports = ["rice"];
    moduleValued.plugins.rice = "rice";
    forced = "rice";
    conditional = "rice";
    settings.replaced = "rice";
    items.entry.first = "rice";
    nested.inner.replaced = "rice";
    selection = {
      name = "rice";
      variant = "rice";
    };
  };
  unselected = rice "unselected" {
    scalar = "unselected";
    ricePreferred = "unselected";
    list = ["unselected"];
  };

  host = choice: {
    delib,
    riceConfig,
    ...
  }:
    delib.host {
      name = "fixture";
      rice = choice;
      myconfig.ifEnabled.probe = {
        hostCleared = null;
        hostRestored.second = "host";
        imported.hostReplaced = "host";
        scalar = "host";
        conditional = "host";
        list = (riceConfig.probe.list or []) ++ ["host"];
        replacedList = ["host"];
        reports = ["host"];
        reportsByName.host = "host";
        imported.reports = ["host"];
        moduleValued.plugins.host = "host";
        settings.keys = ["host"];
        items.entry.second = "host";
        items.function.second = "host";
        selection.name = "host";
      };
    };

  evaluate = hostName: modules: let
    configuration = denix.lib.denixConfiguration {
      extraInputs = inputs;
      specialArgs = {inherit mylib;};
      modules =
        [
          ../../adapters/bundles.nix
          ../../extensions/provenance.nix
          ../../extensions/rices.nix
          probe
          selected
          unselected
        ]
        ++ modules;
    };
    bundles = configuration.genSystem ({
        moduleSystem = "bundles";
        extraArgs = {inherit system;};
      }
      // lib.optionalAttrs (hostName != null) {host = hostName;});
    inherit (bundles) options;
  in {
    values = let
      raw = lib.mapAttrs (_: option: option.value) (removeAttrs options.myconfig.probe ["enable"]);
      sort = lib.sort lib.lessThan;
    in
      raw
      // {
        reports = sort raw.reports;
        imported = raw.imported // {reports = sort raw.imported.reports;};
      };
    files = lib.concatMap (name: map (definition: definition.file) options.myconfig.probe.${name}.definitionsWithLocations) ["scalar" "ricePreferred" "forced"];
  };

  hosted = evaluate "fixture" [(host "selected")];
  hostless = evaluate null [(host "selected")];
  withoutRice = evaluate "fixture" [(host null)];
in {
  cases = {
    higher-source-replaces-what-it-defines = {
      protects = "a module defines below the selected rice, which defines below the host, so the highest source defining a scalar or list replaces it whole";
      expr = lib.getAttrs ["scalar" "ricePreferred" "replacedList"] hosted.values;
      expected = {
        scalar = "host";
        ricePreferred = "rice";
        replacedList = ["host"];
      };
    };
    host-extends-rice-list-through-riceConfig = {
      protects = "a host extends its rice's list by reading it from riceConfig";
      expr = hosted.values.list;
      expected = ["rice" "host"];
    };
    forced-module-value-wins = {
      protects = "a module's mkForce outranks rice and host definitions";
      expr = hosted.values.forced;
      expected = "module";
    };
    function-sections-and-conditions-keep-priority = {
      protects = "function sections and mkIf conditions keep their own shape and the module's priority";
      expr = hosted.values.conditional;
      expected = "host";
    };
    nullable-values-replaced-whole = {
      protects = "nullable structured values are set and cleared across sources and replaced whole, so nothing of a lower source's value remains";
      expr = lib.getAttrs ["riceCleared" "hostCleared" "hostRestored"] hosted.values;
      expected = {
        riceCleared = null;
        hostCleared = null;
        hostRestored = {
          first = "default";
          second = "host";
        };
      };
    };
    imported-definitions-keep-module-priority = {
      protects = "definitions a module imports into a module-valued submodule, as attribute sets, functions or paths, keep the module's priority, and an upstream option marked as accumulating collects every source's contributions";
      expr = hosted.values.imported;
      expected = {
        kept = "module";
        riceReplaced = "rice";
        hostReplaced = "host";
        functionImported = "module";
        pathImported = "module";
        reports = ["host" "module" "rice" "upstream"];
      };
    };
    accumulating-options-collect-every-source = {
      protects = "options declared with mylib.accumulatingOption collect every source's contributions, so no source removes another's";
      expr = lib.getAttrs ["reports" "reportsByName"] hosted.values;
      expected = {
        reports = ["host" "module" "rice"];
        reportsByName = {
          module = "module";
          rice = "rice";
          host = "host";
        };
      };
    };
    function-defined-submodule-adds-other-sources = {
      protects = "other sources' definitions add to the nested attributes of a module-valued submodule a module defines by a function";
      expr = hosted.values.moduleValued;
      expected.plugins = {
        module = "module";
        rice = "rice";
        host = "host";
      };
    };
    typed-settings-merge-per-key = {
      protects = "priorities follow a format type that stores every value as a list of repetitions, so a higher source replaces only the keys it defines";
      expr = hosted.values.settings;
      expected = {
        kept = ["module"];
        replaced = ["rice"];
        keys = ["host"];
      };
    };
    submodules-merge-per-attribute = {
      protects = "priorities follow submodule types, so a higher source replaces only the attributes it defines, and a function definition of a submodule keeps its arguments";
      expr = lib.getAttrs ["items" "nested"] hosted.values;
      expected = {
        items = {
          entry = {
            first = "rice";
            second = "host";
          };
          function = {
            first = "module function";
            second = "host";
          };
        };
        nested.inner = {
          kept = "module";
          replaced = "rice";
        };
      };
    };
    atomic-option-replaced-whole = {
      protects = "a value declared with mylib.atomicOption is replaced whole by a higher source, which does not inherit the lower source's attributes";
      expr = hosted.values.selection;
      expected = {
        name = "host";
        variant = null;
      };
    };
    definitions-carry-origin-labels = {
      protects = "module, rice and host definitions carry labels naming their origin";
      expr = lib.filter (label: lib.elem label hosted.files) ["module probe (myconfig.always)" "rice selected (myconfig)" "host fixture (myconfig.ifEnabled)"];
      expected = ["module probe (myconfig.always)" "rice selected (myconfig)" "host fixture (myconfig.ifEnabled)"];
    };
    no-rice-contributes-without-host = {
      protects = "an evaluation without a host takes no rice's definitions";
      expr = {
        inherit (hostless.values) scalar list;
        selection = hostless.values.selection.name;
      };
      expected = {
        scalar = "module";
        list = ["module"];
        selection = "module";
      };
    };
    unselected-rice-does-not-contribute = {
      protects = "a rice the host does not select contributes no definition";
      expr = lib.elem "rice unselected (myconfig)" hosted.files;
      expected = false;
    };
    host-without-rice-builds-on-modules = {
      protects = "a host without a rice builds on module definitions alone, with an empty riceConfig";
      expr = {inherit (withoutRice.values) ricePreferred list;};
      expected = {
        ricePreferred = "module";
        list = ["host"];
      };
    };
  };
}
