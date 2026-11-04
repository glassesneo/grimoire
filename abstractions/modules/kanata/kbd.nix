# Owns the rendering of the kanata module's options into Kanata's
# configuration language.
#
# An expression is a Kanata s-expression written in Nix: a string is an atom,
# an integer a number, and a list a parenthesized form. Two definitions of one
# expression with different values conflict instead of merging.
#
# `defsrc` lists every key that a layer maps or a chord uses, so no key's
# position is written by hand. Each layer is rendered in that order, with `_`
# for the keys it leaves unmapped, and `defaultLayer` comes first, so it is the
# startup layer and the one that unmapped keys of switched layers fall through
# to (`delegate-to-first-layer`).
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
    # Chord participants outside defsrc would bypass Kanata when
    # process-unmapped-keys is off, so the chords would never fire.
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
