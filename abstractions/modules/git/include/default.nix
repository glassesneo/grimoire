{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "git.include";
  tests.fixture = ["git" "secrets"];
  meta.description = "Configure Git settings through includes.";

  options.enable = delib.boolOption true;

  constraints.ifEnabled = [
    {
      assertion = myconfig.secrets.enable;
      message = "git.include requires secrets.enable = true to decrypt iniad-gitconfig";
    }
  ];

  myconfig.ifEnabled.secrets.required = ["iniad-gitconfig"];

  # Git skips a missing include file silently, so repositories work before the secret is activated.
  hjem.ifEnabled = {config, ...}: {
    git.settings.includeIf."gitdir:${config.directory}/iniad/".path = config.security.nix-secrets.secrets.iniad-gitconfig.path;
  };
})
