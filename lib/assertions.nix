# Reads module-system `assertions` lists of {assertion, message}.
{lib}: {
  # The messages of the assertions that do not hold.
  failed = assertions: map (x: x.message) (lib.filter (x: !x.assertion) assertions);

  # Returns `value` when no message is given, otherwise throws them as a list.
  guard = messages: value:
    if messages != []
    then throw "\nFailed assertions:\n${lib.concatMapStringsSep "\n" (x: "- ${x}") messages}"
    else value;
}
