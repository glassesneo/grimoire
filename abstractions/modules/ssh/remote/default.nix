# A remote host uses the person's keys only through the key holder's remote
# agent (`ssh.keyholder`), which reaches it by Rex's tunnel or by an
# ordinary session; forwarded_agent.nu picks a live one at each use.
# Fetching from GitHub does not need the agent: it goes over HTTPS, and only
# pushes are rewritten to SSH.
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

  # Fetches and the GitHub CLI read with this token instead of the agent.
  myconfig.ifEnabled.secrets.required = ["github-read-token"];

  # Hjem would place authorized_keys as a link into /nix/store, which sshd's
  # StrictModes rejects; nix-darwin's AuthorizedKeysCommand reads it instead.
  darwin.ifEnabled = {
    users.users.${myconfig.host.user.name}.openssh.authorizedKeys.keys = [myconfig.ssh.keys.login.publicKey];
    # sshd keeps a RemoteForward's socket after the session ends; without
    # unlinking it, the next tunnel from the key holder fails to bind.
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
    # Apple's OpenSSH tools are the ones verified with Secure Enclave keys.
    tool = name:
      if darwin
      then "/usr/bin/${name}"
      else "${pkgs.openssh}/bin/${name}";
    # forwarded_agent.nu leaves most calls alone; passing those straight to
    # the program spares starting Nushell, as for each signature Git verifies.
    # A call matching the pattern still goes through it, which decides.
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
        exec ${pkgs.nushell}/bin/nu --no-config-file ${./forwarded_agent.nu} ${mode} "$@"
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
    # Answers Git's `get` with the read-only token; Git ignores a helper's
    # output for `store` and `erase`.
    credentialHelper = pkgs.writeShellScript "github-read-token-credential" ''
      [ "$1" = get ] && [ -r ${lib.escapeShellArg token} ] || exit 0
      printf 'username=x-access-token\npassword=%s\n' "$(cat ${lib.escapeShellArg token})"
    '';
  in {
    # Lets a person run a command, such as `ssh-add -l`, with the agent a
    # signing would use.
    packages = [withAgent];

    # The remote agent holds only the signing and GitHub keys, so ssh may offer
    # each of them; IdentityFile would make ssh drop a Secure Enclave key it
    # has no provider for.
    ssh.hosts."github.com".IdentitiesOnly = false;

    # The GitHub CLI takes a token only from its configuration or the
    # environment; reading it in .zshenv reaches non-interactive shells too.
    zsh.zshenv.github-read-token.text = ''
      if [[ -r ${lib.escapeShellArg token} ]]; then
        export GH_TOKEN="$(<${lib.escapeShellArg token})"
      fi
    '';

    git.settings = {
      gpg.ssh.program = "${keygen}/bin/forwarded-ssh-keygen";
      core.sshCommand = "${forwardedSsh}/bin/forwarded-ssh";
      ssh.variant = "ssh";
      # The empty entry drops helpers configured before, such as the system's
      # keychain.
      credential."https://github.com".helper = ["" "${credentialHelper}"];
      # Fetches use HTTPS whatever a remote's URL says; pushes use SSH. Rewriting
      # an SSH URL to itself for pushes keeps the fetch rewrite from applying.
      url = {
        "https://github.com/".insteadOf = "git@github.com:";
        "git@github.com:".pushInsteadOf = ["https://github.com/" "git@github.com:"];
      };
    };
  };

  tests.cases = {pkgs, ...}: {
    agent-selection = {
      protects = "forwarded_agent.nu uses only a live agent holding the signing key and no foreign key, requires the unlocked GitHub key to push, and leaves other ssh and ssh-keygen calls alone";
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
