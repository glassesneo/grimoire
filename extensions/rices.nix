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
