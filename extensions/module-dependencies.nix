# Owns the enable dependency of a module on its immediate parent and on the
# roles it follows.
#
# `zsh.interactive` depends on `zsh` when that parent is registered and both
# declare `enable`. A module that reads a role's seat, such as its holder,
# declares `meta.follows = [ "<role>" ]` and depends on each `roles.<role>`
# being enabled. The module's declared default becomes its original condition
# AND those enable values, and its `defaultText` says so. Explicit overrides
# are preserved; an enabled module whose parent or followed seat is disabled
# fails through its constraints (`extensions/module-constraints.nix`) in every
# module system, as does a followed role that is not declared. Missing parents
# and modules without `enable` are skipped; more distant ancestors are not
# searched, and unconditional sections are not gated.
{
  delib,
  lib,
  config,
  ...
}: {
  settings.modules.extraSubmodules = {name, ...} @ module: let
    inherit (module.config.meta) follows;
    parts = lib.splitString "." name;
    parent = lib.concatStringsSep "." (lib.init parts);
    hasParent = builtins.length parts > 1 && builtins.hasAttr parent config.modules;
    hasEnable = myoptions: lib.hasAttrByPath (parts ++ ["enable"]) myoptions;
    participates = myoptions:
      hasParent
      && hasEnable myoptions
      && lib.hasAttrByPath (lib.init parts ++ ["enable"]) myoptions;
    # The modules whose enable this module's default requires.
    requirements = myoptions:
      lib.optional (participates myoptions) parent
      ++ lib.optionals (hasEnable myoptions) (map (role: "roles.${role}") follows);
    enabled = myconfig: other: delib.getAttrByStrPath myconfig "${other}.enable" false;
  in {
    options.meta.follows = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Roles whose seat this module reads, by name; the module is enabled by default only while each `roles.<name>` is.";
    };

    # Transform option defaults, not values: explicit overrides still reach constraints.
    options.options = lib.mkOption {
      apply = entries:
        map (entry: let
          transformed = delib.toDenixArgs ({
              myconfig,
              myoptions,
              ...
            } @ args: let
              required = requirements myoptions;
            in
              delib.processModule (declarations:
                declarations
                // lib.optionalAttrs (declarations ? enable && declarations.enable ? default) {
                  enable =
                    declarations.enable
                    // {
                      default = lib.all (enabled myconfig) required && declarations.enable.default;
                    }
                    // lib.optionalAttrs (required != []) {
                      defaultText =
                        lib.literalExpression (lib.concatMapStrings (other: "myconfig.${other}.enable && ") required
                          + declarations.enable.defaultText.text or (lib.generators.toPretty {} declarations.enable.default));
                    };
                }) (delib.callIfDenixArgs entry args));
        in
          if lib.isFunction entry
          then delib.inheritFunctionArgs entry transformed
          else transformed)
        entries;
    };

    # Checked whatever the module's enable, so an enabled module under a
    # disabled parent or seat is rejected.
    config.constraints.always =
      map (role: {
        assertion = config.modules ? "roles.${role}";
        message = "${name}: meta.follows names \"${role}\", which no module roles.${role} declares";
      })
      follows
      ++ lib.optional (follows != []) (delib.toDenixArgs ({
        myconfig,
        myoptions,
        ...
      }: let
        missing = lib.filter (role: !(enabled myconfig "roles.${role}")) follows;
      in {
        assertion = !(hasEnable myoptions) || !(enabled myconfig name) || missing == [];
        message = "${name}.enable = true requires ${lib.concatMapStringsSep " and " (role: "roles.${role}.enable = true") missing}";
      }))
      ++ lib.optional hasParent (delib.toDenixArgs ({
        myconfig,
        myoptions,
        ...
      }: {
        assertion =
          !(participates myoptions)
          || !(enabled myconfig name)
          || enabled myconfig parent;
        message = "${name}.enable requires ${parent}.enable = true";
      }));
  };
}
