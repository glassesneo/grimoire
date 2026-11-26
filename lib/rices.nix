{documented}: {
  rice =
    documented {
      description = "A rice, as docs/architecture.md describes rices.";
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
