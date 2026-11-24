{lib}: let
  inherit (lib) types;

  isAtom = value: builtins.isString value && builtins.match "[^[:space:]()\"]+" value != null;
  isExpression = value:
    isAtom value
    || builtins.isInt value
    || (builtins.isList value && lib.all isExpression value);

  expression = types.mkOptionType {
    name = "kanataExpression";
    description = "Kanata expression (atom string without whitespace, parentheses or quotes; integer; or list of expressions)";
    descriptionClass = "noun";
    check = isExpression;
    merge = lib.options.mergeEqualOption;
  };

  renderExpression = value:
    if builtins.isList value
    then "(${lib.concatMapStringsSep " " renderExpression value})"
    else if builtins.isBool value
    then lib.boolToYesNo value
    else toString value;

  section = name: lines:
    lib.optionalString (lines != []) ''
      (${name}
      ${lib.concatMapStrings (line: "  ${line}\n") lines})
    '';

  pairs = attrs: lib.mapAttrsToList (name: value: "${name} ${renderExpression value}") attrs;
in {
  inherit expression;
  setting = types.either types.bool expression;

  render = {
    settings,
    defaultLayer,
    layers,
    aliases,
    virtualKeys,
    chords,
  }: let
    allLayers = {${defaultLayer} = {};} // layers;
    layerNames = [defaultLayer] ++ lib.remove defaultLayer (builtins.attrNames allLayers);
    keys = lib.unique (lib.sort lib.lessThan (
      lib.concatMap builtins.attrNames (builtins.attrValues allLayers)
      ++ lib.concatMap (chord: chord.keys) (builtins.attrValues chords)
    ));
    defcfg = settings // {delegate-to-first-layer = true;};
    layer = name:
      section "deflayer ${name}"
      (map (key: "${renderExpression (allLayers.${name}.${key} or "_")} ;; ${key}") keys);
    chordLines =
      lib.mapAttrsToList (name: chord: "${
        lib.concatMapStringsSep " " renderExpression [chord.keys chord.action chord.timeout chord.release chord.disabledLayers]
      } ;; ${name}")
      chords;
  in
    lib.concatStrings (
      [
        (section "defcfg" (pairs defcfg))
        (section "defsrc" keys)
        (section "defvirtualkeys" (pairs virtualKeys))
        (section "defalias" (pairs aliases))
      ]
      ++ map layer layerNames
      ++ [(section "defchordsv2" chordLines)]
    );
}
