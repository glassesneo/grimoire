{documented}: {
  rice =
    documented {
      description = "A rice: a named set of `myconfig` choices spanning modules, which a host selects by name with `rice`. Only the selected rice contributes, at the rice priority.";
      arguments = {
        name = "The name a host selects.";
        myconfig = "The choices.";
      };
    } ({
      name,
      myconfig,
    }: {
      rices.${name} = {inherit myconfig;};
    });
}
