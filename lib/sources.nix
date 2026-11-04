# Owns the source priorities of `myconfig` definitions and atomic options.
#
# `priorities` orders the sources: an option default (1500) < a module < a rice
# < a host. Authors write no `mkDefault` to obtain this order.
#
# `prioritize priority options module` gives every definition that `module`
# makes below the option tree `options` the priority of its source. The
# priority is pushed down along the declared types, so a definition from a
# higher source replaces only the values it defines: below a submodule, an
# `attrsOf` or a `lazyAttrsOf`, each option or attribute keeps its own
# priority. Any other value, including lists, derivations and values of types
# without such structure, is replaced as a whole. A `nullOr` is replaced as a
# whole too, so a higher source can set or clear it: the module system filters
# priorities per option before merging, so a nullable value cannot both merge
# across sources and let `null` follow their order. An option declared with
# `atomicOption` stops the descent: a higher source replaces it as a whole.
#
# Priorities order choices. An option that collects contributions instead,
# such as assertions or warnings, is declared with `accumulatingOption` and
# stays outside that order: its definitions from every source, and from the
# module that declares it, receive no source priority and merge by its type,
# so a higher source cannot remove a lower one's contribution. A type that
# does not merge several definitions rejects them as conflicting. Applied to
# a declaration without a type, `accumulatingOption` marks an option that
# another module declares, such as an upstream option in a submodule; the
# module embedding that upstream declares which of its options accumulate.
#
# `mkIf` and `mkMerge` are kept and descended into; a value the author already
# gave an explicit priority keeps it. Function definitions of a submodule are
# wrapped and still receive the arguments they request. Modules a definition
# imports, as attribute sets, functions or paths, receive the same priority.
# Definitions of undeclared attributes, such as freeform settings, receive the
# priority as a whole.
{lib}: let
  # Internal markers; read only through `isAtomic` and `isAccumulating`.
  marker = "_grimoireAtomic";
  accumulatingMarker = "_grimoireAccumulating";

  # Attributes of a shorthand module that are not configuration.
  moduleAttributes = ["_class" "_file" "key" "disabledModules" "require" "imports" "freeformType"];

  typeOf = value: value._type or null;
  isPlainAttrs = value: builtins.isAttrs value && !(value ? _type) && !lib.isDerivation value;

  isAtomic = option: option.${marker} or false;
  isAccumulating = option: option.${accumulatingMarker} or false;

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
      else if isAccumulating declaration
      then value
      else if isAtomic declaration
      then wrap value
      else typed declaration.type value;

    typed = type: value: let
      property = properties (typed type) value;
      elemType = type.nestedTypes.elemType;
    in
      if property != null
      then property
      else if type.name == "submodule" && (lib.isFunction value || isPlainAttrs value)
      then
        # With `shorthandOnlyDefinesConfig`, as `types.submodule` sets, an
        # attribute set definition is configuration only, even `imports`.
        if isPlainAttrs value && type.functor.payload.shorthandOnlyDefinesConfig or false
        then attributes (type.getSubOptions []) value
        else imported (type.getSubOptions []) value
      else if lib.elem type.name ["attrsOf" "lazyAttrsOf"] && isPlainAttrs value
      then lib.mapAttrs (_: typed elemType) value
      else wrap value;

    # A module given as an attribute set, a function or a path.
    imported = node: value:
      if builtins.isPath value || builtins.isString value
      then {
        _file = toString value;
        imports = [(imported node (import value))];
      }
      else if lib.isFunction value
      then
        # A real lambda: the module system loads a functor as an attribute
        # set. Requested arguments resolve as `lib.modules` resolves them.
        {config, ...} @ args:
          module node (value (args
              // builtins.mapAttrs (name: _: args.${name} or config._module.args.${name}) (lib.functionArgs value)))
      else module node value;

    module = node: value: let
      imports = lib.optionalAttrs (value ? imports) {imports = map (imported node) value.imports;};
    in
      if !isPlainAttrs value
      then tree node value
      else if value ? config || value ? options
      then value // lib.optionalAttrs (value ? config) {config = tree node value.config;} // imports
      else let
        configuration = removeAttrs value moduleAttributes;
      in
        lib.getAttrs (lib.intersectLists moduleAttributes (builtins.attrNames value)) value
        // imports
        // attributes node configuration;
  in
    module;
in {
  inherit prioritize;

  priorities = {
    module = 1000;
    rice = 900;
    host = 100;
  };

  atomicOption = option: option // {${marker} = true;};
  accumulatingOption = option: option // {${accumulatingMarker} = true;};
}
