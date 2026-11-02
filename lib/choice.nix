# Owns single-choice options that candidates join by declaration.
#
# The owner declares `option`, an enum that starts empty and defaults to null,
# meaning no choice. Each candidate declares `candidate <value>` at the same
# path, unconditionally, which adds its value to the enum; the option's
# declarations merge into one. Whether a choice is active is derived from the
# value by its owner or candidates, never declared separately.
{lib}: let
  type = values: lib.types.nullOr (lib.types.enum values);
in {
  option = description:
    lib.mkOption {
      type = type [];
      default = null;
      inherit description;
    };

  candidate = value: lib.mkOption {type = type [value];};
}
