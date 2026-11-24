{lib}: {
  failed = assertions: map (x: x.message) (lib.filter (x: !x.assertion) assertions);

  guard = messages: value:
    if messages != []
    then throw "\nFailed assertions:\n${lib.concatMapStringsSep "\n" (x: "- ${x}") messages}"
    else value;
}
