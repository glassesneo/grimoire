{
  delib,
  lib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "grok-bot";
  meta = {
    description = "Provide the Grok-bot desktop app.";
    tags = ["gui"];
  };

  options = with delib; {
    enable = boolOption false;
    package = packageOption myconfig.casks.packages.grok-bot {defaultText = lib.literalExpression "myconfig.casks.packages.grok-bot";};
  };

  hjem.ifEnabled.files."Applications/Grok Bot.app" = {
    exclusive = true;
    source = "${cfg.package}/Applications/Grok Bot.app";
  };
})
