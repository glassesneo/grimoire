{
  delib,
  lib,
  config,
  ...
}: let
  prefix = config.moduleSystems.myconfig.myconfigPrefix;
  withPrefix = name: lib.concatStringsSep "." (lib.optional (prefix != null) prefix ++ [name]);

  unsupported =
    lib.concatLists (lib.mapAttrsToList (name: module:
      lib.optional (module.constraints.ifDisabled != []) "module ${name}: constraints.ifDisabled")
    config.modules)
    ++ lib.concatLists (lib.mapAttrsToList (name: host:
      lib.optional (lib.any (section: host.constraints.${section} != []) ["always" "ifEnabled" "ifDisabled"]) "host ${name}: constraints")
    config.hosts);

  enforce = {
    config,
    options,
    ...
  } @ moduleArgs: let
    resolve = denixArgs: value:
      if delib.isDenixArgs value
      then resolve denixArgs (value denixArgs)
      else if lib.isFunction value
      then
        resolve denixArgs (value (moduleArgs
          // denixArgs
          // builtins.mapAttrs (name: _: denixArgs.${name} or moduleArgs.${name} or config._module.args.${name}) (lib.functionArgs value)))
      else value;
    evaluate = name: entry: let
      result =
        resolve {
          inherit name;
          myconfig = delib.getAttrByStrPath config prefix {};
          myoptions = delib.getAttrByStrPath options prefix {};
          cfg = delib.getAttrByStrPath config (withPrefix name) {};
          opt = delib.getAttrByStrPath options (withPrefix name) {};
        }
        entry;
    in {inherit (result) assertion message;};
    moduleConstraints = name: module:
      map (evaluate name) (
        module.constraints.always
        ++ lib.optionals (delib.getAttrByStrPath config "${withPrefix name}.enable" false) module.constraints.ifEnabled
      );
  in {
    _file = ./module-constraints.nix;
    assertions = lib.concatLists (lib.mapAttrsToList moduleConstraints denixConfig.modules);
  };

  denixConfig = config;
in {
  moduleSystems.constraints = {
    flakeOutputs = {
      modules = null;
      systems = null;
    };
    applyConfigForModuleSystem = _: [];
  };

  rawModules.constraints = lib.optionals (config.moduleSystem.name or null != "myconfig") (
    if unsupported != []
    then throw "Constraints support only module `always` and `ifEnabled` sections; found ${lib.concatStringsSep ", " unsupported}."
    else [enforce]
  );
}
