{lib}: {
  documented = doc: value:
    (
      if lib.isFunction value
      then {__functor = _: value;}
      else value
    )
    // {__doc = doc;};

  library = {
    entries,
    internal ? [],
  }: let
    walk = path: value: let
      name = lib.concatStringsSep "." path;
    in
      if lib.elem name internal
      then []
      else if value ? __doc
      then [
        {
          inherit name;
          doc = value.__doc;
        }
      ]
      else if lib.isFunction value || (builtins.isAttrs value && value ? _type)
      then throw "authoring: ${name} has no documentation; wrap it with mylib.documented or list it as internal"
      else if builtins.isAttrs value && !lib.isDerivation value
      then lib.concatLists (lib.mapAttrsToList (key: walk (path ++ [key])) value)
      else [];
  in
    lib.sort (a: b: a.name < b.name) (lib.concatLists (lib.mapAttrsToList (key: walk [key]) entries));
}
