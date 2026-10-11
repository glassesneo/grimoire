{delib, ...}:
delib.module {
  name = "git.include";
  meta.description = "Configure Git settings through includes.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.secrets.names = ["iniad-gitconfig"];

  # Git skips a missing include file silently, so repositories work before the secret is activated.
  hjem.ifEnabled = {config, ...}: {
    git.settings.includeIf."gitdir:${config.directory}/iniad/".path = config.security.nix-secrets.secrets.iniad-gitconfig.path;
  };
}
