# Owns the plist values that Hjem adapters accept for XML serialization.
#
# `validValue` accepts strings, booleans, integers, lists and dictionaries, not
# floats. `validXml` rejects XML control characters in strings and dictionary
# keys. `xmlString` applies that rule to a single string.
{lib}: rec {
  validValue = v:
    builtins.isString v
    || builtins.isBool v
    || builtins.isInt v
    || (builtins.isList v && lib.all validValue v)
    || (builtins.isAttrs v && lib.all validValue (builtins.attrValues v));
  # Nix strings cannot contain NUL; XML also excludes these remaining C0 controls.
  xmlControls = builtins.fromJSON ''"\u0001-\u0008\u000b\u000c\u000e-\u001f"'';
  xmlString = s: builtins.match "[^${xmlControls}]*" s != null;
  validXml = v:
    if builtins.isString v
    then xmlString v
    else if builtins.isList v
    then lib.all validXml v
    else if builtins.isAttrs v
    then lib.all xmlString (builtins.attrNames v) && lib.all validXml (builtins.attrValues v)
    else true;
}
