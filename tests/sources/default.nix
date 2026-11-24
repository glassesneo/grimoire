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

  expected = {
    riceCleared = null;
    hostCleared = null;
    hostRestored = {
      first = "default";
      second = "host";
    };
    imported = {
      kept = "module";
      riceReplaced = "rice";
      hostReplaced = "host";
      functionImported = "module";
      pathImported = "module";
      reports = ["host" "module" "rice" "upstream"];
    };
    scalar = "host";
    ricePreferred = "rice";
    list = ["rice" "host"];
    replacedList = ["host"];
    reports = ["host" "module" "rice"];
    reportsByName = {
      module = "module";
      rice = "rice";
      host = "host";
    };
    moduleValued.plugins = {
      module = "module";
      rice = "rice";
      host = "host";
    };
    forced = "module";
    conditional = "host";
    settings = {
      kept = ["module"];
      replaced = ["rice"];
      keys = ["host"];
    };
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
    selection = {
      name = "host";
      variant = null;
    };
  };
in {
  check = assert lib.assertMsg (hosted.values == expected)
  "Sources must merge as module < rice < host along the option types:\n${lib.generators.toPretty {} hosted.values}";
  assert lib.assertMsg (lib.all (label: lib.elem label hosted.files) ["module probe (myconfig.always)" "rice selected (myconfig)" "host fixture (myconfig.ifEnabled)"])
  "Rice, module and host definitions must carry their origin labels: ${toString hosted.files}";
  assert lib.assertMsg (hostless.values.scalar == "module" && hostless.values.list == ["module"] && hostless.values.selection.name == "module")
  "Without a host, no rice may contribute";
  assert lib.assertMsg (!(lib.elem "rice unselected (myconfig)" hosted.files))
  "An unselected rice must not contribute";
  assert lib.assertMsg (withoutRice.values.ricePreferred == "module" && withoutRice.values.list == ["host"])
  "A host without a rice must build on modules alone, with an empty riceConfig";
    pkgs.runCommand "sources-test" {} ''
      mkdir "$out"
    '';
}
