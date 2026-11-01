# Owns the declaration of a rice: a named set of `myconfig` choices that spans
# modules. A rice declares no options, has no sections and no enable; a host
# selects at most one by name, and only the selected rice contributes. See
# `extensions/rices.nix` for registration and selection.
_: {
  rice = {
    name,
    myconfig,
  }: {
    rices.${name} = {inherit myconfig;};
  };
}
