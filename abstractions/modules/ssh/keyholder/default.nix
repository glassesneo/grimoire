# The key holder is the host whose Secure Enclave holds the person's SSH keys
# (`ssh.keys`). The keys cannot leave it, so every other host reaches them
# through the remote agent: an ssh-agent of its own, distinct from the
# system's, that holds the signing key at all times and the GitHub key only
# while `push-unlock` has unlocked it. Only that agent is forwarded: ordinary
# sessions forward it with ForwardAgent, and Rex's tunnel, which opens no
# session, carries it to `ssh.rexAgentSocket` with a RemoteForward.
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
  name = "ssh.keyholder";
  tests.fixture = ["host" "ssh" "git" "services"];
  meta.description = "Hold the person's SSH keys in this host's Secure Enclave and lend them to the other hosts through a forwarded agent.";

  options = with delib; {
    enable = boolOption false;
    remoteHosts = listOfOption lib.types.str [] "Hosts, by their literal names in `ssh.hosts`, that log in with the login key and receive the remote agent.";
    unlockDuration = strOption "15m" "How long `push-unlock` without an argument lends the GitHub key, as ssh-add(1) reads a lifetime.";
  };

  constraints.ifEnabled = [
    {
      assertion = lib.hasSuffix "-darwin" myconfig.host.system;
      message = "ssh.keyholder.enable = true requires a Darwin host, whose Secure Enclave holds the keys";
    }
  ];

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    home = config.directory;
    keys = myconfig.ssh.keys;
    socket = "${home}/.ssh/remote-agent.sock";
    handle = purpose: "${home}/.ssh/id_grimoire_${purpose}";
    # Apple's OpenSSH tools are the ones verified with this provider.
    provider = "/usr/lib/ssh-keychain.dylib";
    sshAdd = "/usr/bin/ssh-add";

    remoteAgent = pkgs.writeShellScript "remote-agent" ''
      set -eu
      rm -f ${lib.escapeShellArg socket}
      /usr/bin/ssh-agent -D -a ${lib.escapeShellArg socket} &
      agent=$!
      trap 'kill "$agent" 2>/dev/null' TERM INT
      for _ in $(seq 50); do
        [ -S ${lib.escapeShellArg socket} ] && break
        sleep 0.1
      done
      SSH_AUTH_SOCK=${lib.escapeShellArg socket} ${sshAdd} -S ${provider} ${lib.escapeShellArg (handle "signing")}
      wait "$agent"
    '';

    pushUnlock = pkgs.writeShellScriptBin "push-unlock" ''
      set -eu
      lifetime=${"$"}{1:-${cfg.unlockDuration}}
      SSH_AUTH_SOCK=${lib.escapeShellArg socket} ${sshAdd} -t "$lifetime" -S ${provider} ${lib.escapeShellArg (handle "github")}
      echo "Remote hosts can push to GitHub for $lifetime; push-lock ends it earlier."
    '';
    pushLock = pkgs.writeShellScriptBin "push-lock" ''
      SSH_AUTH_SOCK=${lib.escapeShellArg socket} exec ${sshAdd} -d ${lib.escapeShellArg "${handle "github"}.pub"}
    '';

    # Creates the Secure Enclave identities that are missing and writes the key
    # handles ssh reads, then checks them against `ssh.keys`.
    sshKeys = pkgs.writeShellScriptBin "ssh-keys" ''
      export SSH_KEYS=${lib.escapeShellArg (builtins.toJSON (lib.mapAttrs (purpose: key: key // {handle = handle purpose;}) keys))}
      export SSH_KEY_PROVIDER=${provider}
      export PATH=${lib.makeBinPath [pkgs.coreutils]}:$PATH
      exec ${pkgs.nushell}/bin/nu --no-config-file ${./ssh_keys.nu} "$@"
    '';
  in {
    packages = [pushUnlock pushLock sshKeys];

    # A switch reports keys that are missing, replaced or expiring, without
    # failing: the rest of the configuration does not depend on them.
    applySteps.ssh-keys.package = pkgs.linkFarm "hjem-ssh-keys" {
      "bin/apply" = pkgs.writeShellScript "ssh-keys-apply" "${sshKeys}/bin/ssh-keys check || true";
    };

    userServices.remote-agent = {
      command = ["${remoteAgent}"];
      restart = "always";
    };

    ssh.hosts =
      {
        "github.com" = {
          IdentityFile = handle "github";
          SecurityKeyProvider = provider;
        };
      }
      // lib.genAttrs cfg.remoteHosts (_: {
        IdentityFile = handle "login";
        SecurityKeyProvider = provider;
        ForwardAgent = socket;
      });

    # Rex's GUI starts its tunnel as `ssh -N … -L <app socket>:<server socket>`
    # with an app socket directly under its ssh directory; its CLI's tunnels
    # put theirs one level deeper. Only the GUI's tunnel carries the agent, so a
    # short-lived CLI tunnel does not take the remote path from it. Matching
    # depends on that layout: if Rex changes it, Rex sessions only lose the agent.
    ssh.matches = lib.listToAttrs (map (host:
      lib.nameValuePair "rex-${host}" {
        criteria = ''originalhost ${host} exec "/bin/ps -o command= -p $PPID | /usr/bin/grep -Eq '/rex/ssh/[0-9a-f]+[.]sock:'"'';
        # The remote hosts share this host's home directory path.
        parameters.RemoteForward = "${myconfig.host.user.homeDirectory}/${myconfig.ssh.rexAgentSocket} ${socket}";
      })
    cfg.remoteHosts);

    # Signing goes through the remote agent here too, so one agent signs for
    # every host.
    git.settings = {
      gpg.ssh.program = "${pkgs.writeShellScript "ssh-keygen-remote-agent" ''
        SSH_AUTH_SOCK=${lib.escapeShellArg socket} exec /usr/bin/ssh-keygen "$@"
      ''}";
      url."git@github.com:".insteadOf = "https://github.com/";
    };
  };
})
