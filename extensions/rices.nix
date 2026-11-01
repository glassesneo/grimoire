# Owns rice registration and selection.
#
# A rice (`mylib.rice`) is registered by name under `rices`. A host selects at
# most one with `rice`; only the selected rice's `myconfig` joins the
# evaluation, labelled `rice <name> (myconfig)`, at the rice priority of
# `extensions/provenance.nix`. Without a host or without a selection, no rice
# contributes.
#
# Declaration files receive `riceConfig`: the `myconfig` the selected rice
# declares, as written, without option defaults, other sources or priorities,
# and `{}` when nothing is selected. A host refers to it to extend a value the
# rice defines instead of reading the final `myconfig`, which would recurse.
# It describes the host being built, so only sections applied to that host,
# such as a host's `ifEnabled`, read it meaningfully.
{
  delib,
  lib,
  config,
  mylib,
  ...
}: let
  selected =
    if config.host == null
    then null
    else config.host.rice;

  riceConfig =
    if selected == null
    then {}
    else config.rices.${selected}.myconfig;

  myconfigSystem = config.moduleSystems.myconfig;

  # A function module, so the option tree of each evaluation guides priorities.
  riceModule = {options, ...}: {
    _file = "rice ${selected} (myconfig)";
    key = "grimoire.rices.${selected}";
    config =
      mylib.sources.prioritize mylib.sources.priorities.rice
      (delib.getAttrByStrPath options myconfigSystem.myconfigPrefix {})
      riceConfig;
  };
in {
  options.rices = lib.mkOption {
    type = lib.types.attrsOf (lib.types.submodule {
      options.myconfig = lib.mkOption {
        # One definition per rice: a name declared twice fails.
        type = lib.types.addCheck lib.types.raw builtins.isAttrs // {description = "attribute set";};
        description = "The `myconfig` values this rice chooses.";
      };
    });
    default = {};
    description = "Registered rices by name.";
  };

  config = {
    settings.hosts.extraSubmodules.options.rice = lib.mkOption {
      type = lib.types.nullOr (lib.types.enum (builtins.attrNames config.rices));
      default = null;
      description = "Rice whose `myconfig` this host builds on; `null` selects none.";
    };

    _module.args.riceConfig = riceConfig;

    rawModules.myconfig = lib.optionals (selected != null) (myconfigSystem.applyConfigForModuleSystem riceModule);
  };
}
