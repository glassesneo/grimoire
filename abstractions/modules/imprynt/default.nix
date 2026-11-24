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
    deployment = types.submodule {
      options = {
        root = mkOption {
          type = types.path;
          description = "Absolute destination root, resolved and recorded by imprynt.";
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
    };
  in {
    options.imprynt.deployments = mkOption {
      type = types.attrsOf deployment;
      default = {};
      description = "Independent real-file deployments, named by safe single path components. Removing an entry removes the files it installed.";
    };
    config.applySteps.imprynt.package = imprynt.mkDeployments {
      inherit pkgs;
      stateDirectory = "${config.xdg.state.directory}/imprynt";
      inherit (config.imprynt) deployments;
    };
  };
}
