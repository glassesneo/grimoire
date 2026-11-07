{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "ssh";
  requires = ["exclusive"];
  meta.description = "Configure the OpenSSH client and the user's personal key.";

  options = with delib; {
    enable = boolOption true;
    personalKeyFile = readOnly (description (strOption "~/.ssh/id_ed25519_personal") "Path of the personal SSH private key on each host, used for GitHub authentication and Git commit signing.");
  };

  hjem.ifEnabled = {pkgs, ...}: {
    files.".ssh/config" = {
      exclusive = true;
      text =
        ''
          Host github.com
            HostName github.com
            User git
            IdentityFile ${cfg.personalKeyFile}

          Host *
            AddKeysToAgent yes
            IdentitiesOnly yes
        ''
        + lib.optionalString pkgs.stdenv.hostPlatform.isDarwin "  UseKeychain yes\n";
    };
  };
})
