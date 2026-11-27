{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "antigravity-cli";
  meta.description = "Provide the Google Antigravity CLI.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {
    packages = [myconfig.agents.packages.antigravity-cli];
  };
})
