# Owns single-definer files.
#
# A file declared with `exclusive = true` must be defined from one location; a
# second module or host defining it fails through the assertions. Locations are
# the origin labels of `extensions/provenance.nix`; definitions an upstream
# module makes beside its own declarations, such as defaults, do not count.
# The covered file sets are Hjem's `files` and `xdg.<kind>.files`, and
# nix-darwin's `environment.etc`; Hjem and nix-darwin merge `text` definitions
# silently, so exclusivity counts definition locations instead.
{
  delib,
  lib,
  ...
}: let
  # Extends each file of the sets at `paths` and asserts their exclusivity.
  exclusiveFiles = paths: {config, ...}: let
    fileExtension = {options, ...}: {
      options = {
        exclusive = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Whether a single location must define this file.";
        };
        definers = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          internal = true;
          readOnly = true;
          description = "Locations defining this file, excluding option declarations.";
        };
      };

      config.definers = lib.unique (lib.concatMap
        (option:
          map (definition: definition.file)
          (lib.filter
            (definition: !(lib.elem definition.file option.declarations))
            option.definitionsWithLocations))
        (lib.collect lib.isOption (builtins.removeAttrs options ["_module" "exclusive" "definers"])));
    };
  in {
    options = lib.foldl' lib.recursiveUpdate {} (map
      (path:
        lib.setAttrByPath path (lib.mkOption {
          type = lib.types.attrsOf (lib.types.submodule fileExtension);
        }))
      paths);

    config.assertions = lib.concatMap (path:
      lib.mapAttrsToList (name: file: {
        assertion = !file.exclusive || builtins.length file.definers <= 1;
        message = "${lib.concatStringsSep "." path}.\"${name}\" is exclusive but defined by: ${lib.concatStringsSep ", " file.definers}";
      })
      (lib.getAttrFromPath path config))
    paths;
  };
in
  delib.module {
    name = "exclusive";
    meta.description = "Reject a second definition of a file that one location must own.";

    hjem.always = exclusiveFiles [
      ["files"]
      ["xdg" "cache" "files"]
      ["xdg" "config" "files"]
      ["xdg" "data" "files"]
      ["xdg" "state" "files"]
    ];

    darwin.always = exclusiveFiles [["environment" "etc"]];

    # Definers are told apart by provenance labels, so each case defines the file
    # from a different module or host.
    tests = _: let
      owner = set: {
        always = lib.setAttrByPath set {
          exclusive = true;
          text = "owner";
        };
      };
      hjemFile = ["files" ".owned"];
      etcFile = ["environment" "etc" "owned"];
      # nix-darwin needs the host's system, which these modules provide.
      darwinCase = case:
        {
          platforms = ["aarch64-darwin"];
          moduleSystem = "darwin";
          uses = ["host" "nixpkgs"];
        }
        // case;
    in {
      second-module = {
        protects = "a second module defining an exclusive Hjem file is rejected";
        modules = {
          owner.hjem = owner hjemFile;
          intruder.hjem.always.files.".owned".text = "intruder";
        };
        fails = ''files.".owned" is exclusive but defined by'';
      };
      host-definer = {
        protects = "a host defining an exclusive Hjem file is rejected";
        modules.owner.hjem = owner ["xdg" "state" "files" "owned"];
        host.hjem.ifEnabled.xdg.state.files.owned.text = "host";
        fails = ''xdg.state.files."owned" is exclusive but defined by'';
      };
      etc-second-module = darwinCase {
        protects = "a second module defining an exclusive environment.etc file is rejected";
        modules = {
          owner.darwin = owner etcFile;
          intruder.darwin.always.environment.etc.owned.text = "intruder";
        };
        fails = ''environment.etc."owned" is exclusive but defined by'';
      };
    };
  }
