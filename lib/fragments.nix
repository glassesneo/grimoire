{
  lib,
  documented,
}: let
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
  option =
    documented {
      description = "An option of named fragments, for a file that several features contribute to. Its owner declares it in its module system and writes `render` of its value into the file. Each fragment has `text` and orders itself against others by name with `after` and `before`; two definitions of one fragment with different text conflict.";
    } (lib.mkOption {
      type = types.attrsOf fragmentType;
      default = {};
      description = "Fragments rendered in dependency order.";
    });

  render =
    documented {
      description = "The fragments' text in dependency order. Fragments without a declared order between them appear in a stable but unspecified order, so a fragment that relies on another's position declares it. A reference to an undefined fragment or a cycle fails.";
      arguments.fragments = "The value of an option declared with `option`.";
    } (fragments: let
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
      else lib.concatMapStringsSep "\n" (entry: entry.text) sorted.result);
}
