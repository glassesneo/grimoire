# Owns the source priorities of `myconfig` definitions and atomic options.
#
# `priorities` orders the sources: an option default (1500) < a module < a rice
# < a host. Authors write no `mkDefault` to obtain this order.
#
# `prioritize priority options module` gives every definition that `module`
# makes below the option tree `options` the priority of its source. The
# priority is pushed down along the declared types, so a definition from a
# higher source replaces only the values it defines: below a submodule, an
# `attrsOf`, a `lazyAttrsOf` or a non-null `nullOr`, each option or attribute
# keeps its own priority. Any other value, including lists, derivations and
# values of types without such structure, is replaced as a whole. An option
# declared with `atomicOption` stops the descent: a higher source replaces it as
# a whole. `mkIf` and `mkMerge` are kept and descended into; a value the author
# already gave an explicit priority keeps it. Function definitions of a
# submodule are wrapped and still receive the arguments they request. Definitions of undeclared
# attributes, such as freeform settings, receive the priority as a whole.
{lib}: let
  # Internal marker; read only through `isAtomic`.
  marker = "_grimoireAtomic";

  # Attributes of a shorthand module that are not configuration.
  moduleAttributes = ["_class" "_file" "key" "disabledModules" "require" "imports" "freeformType"];

  typeOf = value: value._type or null;
  isPlainAttrs = value: builtins.isAttrs value && !(value ? _type) && !lib.isDerivation value;

  isAtomic = option: option.${marker} or false;

  prioritize = priority: let
    wrap = lib.mkOverride priority;

    # Keeps explicit priorities and descends through conditions and merges;
    # null when the value carries no such property.
    properties = descend: value:
      if typeOf value == "override"
      then value
      else if typeOf value == "if"
      then value // {content = descend value.content;}
      else if typeOf value == "merge"
      then value // {contents = map descend value.contents;}
      else null;

    tree = node: value: let
      property = properties (tree node) value;
    in
      if property != null
      then property
      else if typeOf node == "option"
      then option node value
      else if isPlainAttrs value
      then attributes node value
      else wrap value;

    # Attribute names come from the value alone, so a module's shape never
    # depends on the option tree it is evaluated against.
    attributes = node:
      lib.mapAttrs (name: value:
        if builtins.isAttrs node && node ? ${name}
        then tree node.${name} value
        else wrap value);

    option = declaration: value: let
      property = properties (option declaration) value;
    in
      if property != null
      then property
      else if isAtomic declaration
      then wrap value
      else typed declaration.type value;

    typed = type: value: let
      property = properties (typed type) value;
      elemType = type.nestedTypes.elemType;
    in
      if property != null
      then property
      else if type.name == "submodule"
      then
        if lib.isFunction value
        then
          # A real lambda: the module system loads a functor as an attribute
          # set. Requested arguments resolve as `lib.modules` resolves them.
          {config, ...} @ args:
            module (type.getSubOptions []) (value (args
                // builtins.mapAttrs (name: _: args.${name} or config._module.args.${name}) (lib.functionArgs value)))
        else if isPlainAttrs value
        then module (type.getSubOptions []) value
        else wrap value
      else if lib.elem type.name ["attrsOf" "lazyAttrsOf"] && isPlainAttrs value
      then lib.mapAttrs (_: typed elemType) value
      else if type.name == "nullOr" && value != null
      then typed elemType value
      else wrap value;

    module = node: value:
      if !isPlainAttrs value
      then tree node value
      else if value ? config || value ? options
      then value // lib.optionalAttrs (value ? config) {config = tree node value.config;}
      else let
        configuration = removeAttrs value moduleAttributes;
      in
        lib.getAttrs (lib.intersectLists moduleAttributes (builtins.attrNames value)) value
        // attributes node configuration;
  in
    module;
in {
  inherit isAtomic prioritize;

  priorities = {
    module = 1000;
    rice = 900;
    host = 100;
  };

  atomicOption = option: option // {${marker} = true;};
}
