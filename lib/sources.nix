{lib}: let
  marker = "_grimoireAtomic";
  accumulatingMarker = "_grimoireAccumulating";

  moduleAttributes = ["_class" "_file" "key" "disabledModules" "require" "imports" "freeformType"];

  typeOf = value: value._type or null;
  isPlainAttrs = value: builtins.isAttrs value && !(value ? _type) && !lib.isDerivation value;

  isAtomic = option: option.${marker} or false;
  isAccumulating = option: option.${accumulatingMarker} or false;

  prioritize = priority: let
    wrap = lib.mkOverride priority;

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
        if isPlainAttrs value && type.functor.payload.shorthandOnlyDefinesConfig or false
        then attributes (type.getSubOptions []) value
        else imported (type.getSubOptions []) value
      else if lib.elem type.name ["attrsOf" "lazyAttrsOf"] && isPlainAttrs value
      then lib.mapAttrs (_: typed elemType) value
      else wrap value;

    imported = node: value:
      if builtins.isPath value || builtins.isString value
      then {
        _file = toString value;
        imports = [(imported node (import value))];
      }
      else if lib.isFunction value
      then
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
