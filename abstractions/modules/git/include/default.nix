{delib, ...}:
delib.module {
  name = "git.include";
  meta.description = "Configure Git settings through includes.";

  options.enable = delib.boolOption true;

  # Git skips a missing include file silently, so repositories work before the secret is activated.
  # The secret is requested in Hjem, where it merges with the selection in
  # `secrets.names`; that selection is a host's choice and replaces lower sources.
  hjem.ifEnabled = {config, ...}: {
    security.nix-secrets.secrets.iniad-gitconfig = {};
    git.settings.includeIf."gitdir:${config.directory}/iniad/".path = config.security.nix-secrets.secrets.iniad-gitconfig.path;
  };
}
