{
  lib,
  documented,
}: {
  failed = documented {
    description = "The messages of the assertions that do not hold.";
    arguments.assertions = "A module system's `assertions`: a list of `{ assertion, message }`.";
  } (assertions: map (x: x.message) (lib.filter (x: !x.assertion) assertions));

  guard = messages: value:
    if messages != []
    then throw "\nFailed assertions:\n${lib.concatMapStringsSep "\n" (x: "- ${x}") messages}"
    else value;
}
