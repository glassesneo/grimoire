{lib}: let
  inherit (lib) types;

  fragmentType = types.submodule {
    options = {
      # `str` rather than `lines`: two modules defining one fragment differently
      # is a conflict, not a concatenation.
      text = lib.mkOption {
        type = types.str;
        description = "Text of the fragment.";
      };
      after = lib.mkOption {
        type = types.listOf types.str;
        default = [];
        description = "Fragments that must precede this one.";
      };
      before = lib.mkOption {
        type = types.listOf types.str;
        default = [];
        description = "Fragments that must follow this one.";
      };
    };
  };
in {
  option = lib.mkOption {
    type = types.attrsOf fragmentType;
    default = {};
    description = "Fragments rendered in dependency order.";
  };

  render = fragments: let
    entries = lib.mapAttrsToList (name: fragment: fragment // {inherit name;}) fragments;

    dangling =
      lib.concatMap
      (entry:
        map (ref: "${entry.name} -> ${ref}")
        (lib.filter (ref: !(fragments ? ${ref})) (entry.after ++ entry.before)))
      entries;

    precedes = a: b: lib.elem a.name b.after || lib.elem b.name a.before;
    sorted = lib.toposort precedes entries;
  in
    if dangling != []
    then throw "fragments: references to undefined fragments: ${lib.concatStringsSep ", " dangling}"
    else if sorted ? cycle
    then throw "fragments: dependency cycle among: ${lib.concatMapStringsSep ", " (entry: entry.name) sorted.cycle}"
    else lib.concatMapStringsSep "\n" (entry: entry.text) sorted.result;
}
