# Owns real-file deployment declarations and their Hjem apply step.
# Deployments have independent journals under the user's state directory.
# Keep an empty deployment at its original root and stateDirectory to retire its
# files; removing or renaming the deployment itself does not run its old journal.
# The step delegates file ownership, conflict handling and recovery to imprynt.
{
  delib,
  inputs,
  lib,
  ...
}:
delib.module {
  name = "imprynt";
  meta.description = "Declare real-file deployments and apply them through imprynt.";

  hjem.always = {
    config,
    pkgs,
    ...
  }: let
    inherit (lib) mkOption types;
    imprynt = inputs.imprynt.lib;
    safeNames = values: lib.all (name: builtins.match "[A-Za-z0-9][A-Za-z0-9._-]*" name != null) (lib.attrNames values);
    # Nix normalizes submodules through substSubModules; attrsOf otherwise
    # reconstructs its type there without the added name check.
    namedDeployments = elementType:
      types.addCheck (types.attrsOf elementType) safeNames
      // {
        substSubModules = modules: namedDeployments (elementType.substSubModules modules);
      };
    deployment = types.submodule ({name, ...}: {
      options = {
        root = mkOption {
          type = types.path;
          description = "Absolute destination root, resolved and recorded by imprynt.";
        };
        stateDirectory = mkOption {
          type = types.path;
          default = "${config.xdg.state.directory}/imprynt/${name}";
          defaultText = "\${config.xdg.state.directory}/imprynt/<name>";
          description = "Private persistent state, outside the destination root on the same filesystem; do not edit or delete its journal.";
        };
        files = mkOption {
          type = types.listOf imprynt.types.entry;
          default = [];
          description = "Explicit source files and their root-relative destinations.";
        };
        trees = mkOption {
          type = types.listOf imprynt.types.tree;
          default = [];
          description = "Source trees enumerated at build time, preserving relative file paths below each prefix.";
        };
      };
    });
    deployments = lib.mapAttrs (name: value:
      imprynt.mkDeployment (value
        // {
          inherit pkgs;
          name = "grimoire-${name}";
        }))
    config.imprynt.deployments;
    apply = pkgs.writeShellScriptBin "apply" ''
      set -eu
      ${lib.concatMapStringsSep "\n" (name: "${deployments.${name}}/bin/apply") (lib.attrNames deployments)}
    '';
  in {
    options.imprynt.deployments = mkOption {
      type = namedDeployments deployment;
      default = {};
      description = "Independent real-file deployments, named by safe single path components. Keep an empty entry to remove its last files; removing an entry skips its cleanup.";
    };
    config.applySteps.imprynt.package = apply.overrideAttrs (old: {
      passthru = (old.passthru or {}) // {inherit deployments;};
    });
  };

  tests.cases = {home, ...}:
    lib.genAttrs ["" "." ".." "../escape" "/absolute" "nested/name"] (name: {
      protects = "deployment names cannot escape the private state directory through path components";
      host.hjem.ifEnabled.imprynt.deployments.${name}.root = "${home}/destination";
      expr = result: result.apply.steps.imprynt;
      fails = true;
    });
}
