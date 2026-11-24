{
  rice = {
    name,
    myconfig,
  }: {
    rices.${name} = {inherit myconfig;};
  };
}
