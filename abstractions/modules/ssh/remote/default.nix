{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "ssh.remote";
  tests.fixture = ["host" "ssh" "git" "users" "secrets" "zsh"];
  meta.description = "Let the key holder log in to this host, and sign and push to GitHub here with the keys its forwarded agent lends.";

  options = with delib; {
    enable = boolOption false;
  };

  constraints.ifEnabled = [
    {
      assertion = myconfig.secrets.enable;
      message = "ssh.remote.enable = true requires secrets.enable = true to decrypt github-read-token";
    }
  ];

  myconfig.ifEnabled.secrets.required = ["github-read-token"];

  darwin.ifEnabled = {
    users.users.${myconfig.host.user.name}.openssh.authorizedKeys.keys = [myconfig.ssh.keys.login.publicKey];
    services.openssh.extraConfig = ''
      StreamLocalBindUnlink yes
    '';
  };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    darwin = pkgs.stdenv.hostPlatform.isDarwin;
    tool = name:
      if darwin
      then "/usr/bin/${name}"
      else "${pkgs.openssh}/bin/${name}";
    entry = name: mode: passUnless:
      pkgs.writeShellScriptBin name ''
        ${lib.optionalString (passUnless != null) ''
          case " $* " in
            ${passUnless.pattern}) ;;
            *) exec ${tool passUnless.program} "$@" ;;
          esac
        ''}
        export WFA_SIGNING_KEY=${lib.escapeShellArg myconfig.ssh.keys.signing.publicKey}
        export WFA_PUSH_KEY=${lib.escapeShellArg myconfig.ssh.keys.github.publicKey}
        export WFA_SSH_ADD=${tool "ssh-add"} WFA_SSH_KEYGEN=${tool "ssh-keygen"} WFA_SSH=${tool "ssh"}
        export WFA_REX_SOCKET=${lib.escapeShellArg "${myconfig.host.user.homeDirectory}/${myconfig.ssh.rexAgentSocket}"} WFA_TIMEOUT=${pkgs.coreutils}/bin/timeout
        index=0
        for argument; do
          export "WFA_ARG_$index=$argument"
          index=$((index + 1))
        done
        export WFA_ARGC=$index
        exec ${pkgs.nushell}/bin/nu --no-config-file ${./forwarded_agent.nu} ${mode}
      '';
    withAgent = entry "with-forwarded-agent" "exec" null;
    keygen = entry "forwarded-ssh-keygen" "ssh-keygen" {
      pattern = ''*" sign "*'';
      program = "ssh-keygen";
    };
    forwardedSsh = entry "forwarded-ssh" "ssh" {
      pattern = "*github.com*";
      program = "ssh";
    };
    token = config.security.nix-secrets.secrets.github-read-token.path;
    credentialHelper = pkgs.writeShellScript "github-read-token-credential" ''
      [ "$1" = get ] && [ -r ${lib.escapeShellArg token} ] || exit 0
      printf 'username=x-access-token\npassword=%s\n' "$(cat ${lib.escapeShellArg token})"
    '';
  in {
    packages = [withAgent];

    ssh.hosts."github.com".IdentitiesOnly = false;

    zsh.zshenv.github-read-token.text = ''
      if [[ -r ${lib.escapeShellArg token} ]]; then
        export GH_TOKEN="$(<${lib.escapeShellArg token})"
      fi
    '';

    git.settings = {
      gpg.ssh.program = "${keygen}/bin/forwarded-ssh-keygen";
      core.sshCommand = "${forwardedSsh}/bin/forwarded-ssh";
      ssh.variant = "ssh";
      credential."https://github.com".helper = ["" "${credentialHelper}"];
      url = {
        "https://github.com/".insteadOf = "git@github.com:";
        "git@github.com:".pushInsteadOf = ["https://github.com/" "git@github.com:"];
      };
    };
  };

  tests.cases = {pkgs, ...}: {
    agent-selection = {
      protects = "forwarded_agent.nu uses only a live agent holding the signing key and no foreign key, requires the unlocked GitHub key to push, and leaves other ssh and ssh-keygen calls alone with their arguments intact";
      build = _:
        pkgs.runCommand "forwarded-agent-test" {nativeBuildInputs = [pkgs.nushell pkgs.socat pkgs.coreutils];} ''
          export FAKE_SSH_ADD=$PWD/fake-ssh-add
          printf '#!/bin/sh\nexec nu --no-config-file %s "$@"\n' ${./fake-ssh-add.nu} > "$FAKE_SSH_ADD"
          chmod +x "$FAKE_SSH_ADD"
          nu --no-config-file ${./forwarded_agent_test.nu} ${./forwarded_agent.nu}
          touch $out
        '';
    };
  };
})
