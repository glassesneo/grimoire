{delib, ...}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "notion";
  tests.fixture = ["exclusive"];
  meta = {
    description = "Provide the Notion desktop app.";
    tags = ["gui"];
  };

  options = with delib; {
    enable = boolOption false;
    package = packageOption myconfig.casks.packages.notion;
  };

  hjem.ifEnabled.files."Applications/Notion.app" = {
    exclusive = true;
    source = "${cfg.package}/Applications/Notion.app";
  };
})
