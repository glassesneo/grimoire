{lib}: rec {
  finite = v: v - v == 0.0;
  validValue = v:
    builtins.isString v
    || builtins.isBool v
    || builtins.isInt v
    || (builtins.isFloat v && finite v)
    || (builtins.isList v && lib.all validValue v)
    || (builtins.isAttrs v && lib.all validValue (builtins.attrValues v));
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
  element = v:
    if builtins.isBool v
    then
      (
        if v
        then "<true/>"
        else "<false/>"
      )
    else if builtins.isInt v
    then "<integer>${toString v}</integer>"
    else if builtins.isFloat v
    then "<real>${builtins.toJSON v}</real>"
    else if builtins.isList v
    then "<array>${lib.concatMapStrings element v}</array>"
    else if builtins.isAttrs v
    then "<dict>${lib.concatStrings (lib.mapAttrsToList (key: value: "<key>${lib.escapeXML key}</key>${element value}") v)}</dict>"
    else "<string>${lib.escapeXML v}</string>";
  toPlist = v: ''
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">${element v}</plist>
  '';
}
