{
  inputs,
  denix,
  pkgs,
  system,
}: let
  lib = pkgs.lib;
  mylib = import ../../lib {inherit lib;};

  # Repository-owned contract of source priorities and rice selection: a module
  # defines below the selected rice, which defines below the host; priorities
  # follow the declared types, so a higher source replaces only what it defines.
  # Observed through `myconfig` values of a bundles evaluation, the smallest
  # module system that reports its options.
  probe = {delib, ...}:
    delib.module {
      name = "probe";
      options = with delib; {
        enable = boolOption true;
        scalar = strOption "default";
        ricePreferred = strOption "default";
        list = listOfOption str [];
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
        selection = mylib.atomicOption (submoduleOption {
          options = {
            name = strOption "default";
            variant = allowNull (strOption null);
          };
        } {});
      };

      myconfig.always.probe = {
        scalar = "module";
        ricePreferred = "module";
        list = ["module"];
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
        # A function definition of a submodule keeps its arguments.
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
      # Function sections and conditions keep their own shape.
      myconfig.ifEnabled = {lib, ...}: {
        probe.conditional = lib.mkIf true "module";
      };
    };

  rice = name: value: {...}:
    mylib.rice {
      inherit name;
      myconfig.probe = value;
    };

  selected = rice "selected" {
    scalar = "rice";
    ricePreferred = "rice";
    list = ["rice"];
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
        scalar = "host";
        conditional = "host";
        # Extends the rice's list explicitly; a bare list would replace it.
        list = (riceConfig.probe.list or []) ++ ["host"];
        settings.keys = ["host"];
        items.entry.second = "host";
        items.function.second = "host";
        # Replaces the rice's selection whole: its variant is not inherited.
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
    options =
      (configuration.genSystem ({
          moduleSystem = "bundles";
          extraArgs = {inherit system;};
        }
        // lib.optionalAttrs (hostName != null) {host = hostName;})).options;
  in {
    values = lib.mapAttrs (_: option: option.value) (removeAttrs options.myconfig.probe ["enable"]);
    # Only the definitions of the winning priority remain, so each source wins one.
    files = lib.concatMap (name: map (definition: definition.file) options.myconfig.probe.${name}.definitionsWithLocations) ["scalar" "ricePreferred" "forced"];
  };

  hosted = evaluate "fixture" [(host "selected")];
  hostless = evaluate null [(host "selected")];
  withoutRice = evaluate "fixture" [(host null)];

  expected = {
    scalar = "host";
    ricePreferred = "rice";
    list = ["rice" "host"];
    forced = "module";
    conditional = "host";
    # Ghostty's settings type stores every value as a list of repetitions.
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
