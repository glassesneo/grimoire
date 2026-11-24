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
