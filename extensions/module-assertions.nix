# Owns the common assertions that modules declare.
#
# A module writes `assertions.always`, checked whatever its enable, and
# `assertions.ifEnabled`, checked while its `enable` is true. Each entry is an
# `{ assertion, message }` attribute set and receives the module's Denix
# arguments, such as `cfg` and `myconfig`, from the final `myconfig` of the
# evaluation. Denix reads the number of entries before it has those arguments,
# so the list's shape must not depend on them; a variable number of problems
# goes into one entry. Every module system that Denix evaluates enforces them through
# its own `assertions`, so an invalid combination of choices fails ordinary
# configuration builds as well as checks. Assertions about one module system's
# outputs stay in that system's sections.
#
# `assertions` is registered as a module system only so that Denix gives its
# sections the module's arguments; it is never evaluated or published, and
# `ifDisabled` sections and host sections are rejected.
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
      lib.optional (module.assertions.ifDisabled != []) "module ${name}: assertions.ifDisabled")
    config.modules)
    ++ lib.concatLists (lib.mapAttrsToList (name: host:
      lib.optional (lib.any (section: host.assertions.${section} != []) ["always" "ifEnabled" "ifDisabled"]) "host ${name}: assertions")
    config.hosts);

  enforce = {
    config,
    options,
    ...
  } @ moduleArgs: let
    # Denix hands entries over as functions of Denix and module arguments;
    # requested arguments resolve as `lib.modules` resolves them.
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
    moduleAssertions = name: module:
      map (evaluate name) (
        module.assertions.always
        ++ lib.optionals (delib.getAttrByStrPath config "${withPrefix name}.enable" false) module.assertions.ifEnabled
      );
  in {
    _file = ./module-assertions.nix;
    assertions = lib.concatLists (lib.mapAttrsToList moduleAssertions denixConfig.modules);
  };

  denixConfig = config;
in {
  moduleSystems.assertions = {
    flakeOutputs = {
      modules = null;
      systems = null;
    };
    applyConfigForModuleSystem = _: [];
  };

  # Joins only evaluations of a module system that declares `assertions`; a
  # `myconfig`-only evaluation, such as the authoring reference, has none.
  rawModules.assertions = lib.optionals (config.moduleSystem.name or null != "myconfig") (
    if unsupported != []
    then throw "Common assertions support only module `always` and `ifEnabled` sections; found ${lib.concatStringsSep ", " unsupported}."
    else [enforce]
  );
}
