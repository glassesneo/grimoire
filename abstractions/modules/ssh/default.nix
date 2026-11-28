{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (lib) types;
  key = types.submodule {
    options = {
      label = lib.mkOption {
        type = types.strMatching "[A-Za-z0-9._-]+";
        description = "Label of the key's CryptoTokenKit identity in the key holder's Secure Enclave.";
      };
      publicKey = lib.mkOption {
        type = types.strMatching "[a-z0-9@.-]+ [A-Za-z0-9+/=]+( .*)?";
        description = "OpenSSH public key.";
      };
      expires = lib.mkOption {
        type = types.strMatching "[0-9]{4}-[0-9]{2}-[0-9]{2}";
        description = "Date, as YYYY-MM-DD, on which the identity's certificate expires; the key may stop working then.";
      };
    };
  };
  keyOption = description: default:
    lib.mkOption {
      type = key;
      inherit default description;
      readOnly = true;
    };
in
  delib.module ({cfg, ...}: {
    name = "ssh";
    tests.fixture = ["exclusive" "zsh.interactive"];
    meta.description = "Configure the OpenSSH client, declare the person's SSH keys and the commands sshd runs as the user at the start of each session.";

    options = with delib; {
      enable = boolOption true;
      rexAgentSocket = strOption ".ssh/rex-agent.sock" "Path, relative to the user's home on a remote host, where Rex's tunnel from the key holder binds the remote agent.";
      keys = {
        login = keyOption "Key that logs in to the person's hosts." {
          label = "grimoire-login";
          publicKey = "sk-ecdsa-sha2-nistp256@openssh.com AAAAInNrLWVjZHNhLXNoYTItbmlzdHAyNTZAb3BlbnNzaC5jb20AAAAIbmlzdHAyNTYAAABBBMV/ehrmAU9vUsqDWE9LKNxxO6pfe6MAwbRPHkgUGqrb/nQ9mhqOPiNhWDG0luLO6J5R7u7A9RFxgIkfCljMshgAAAAEc3NoOg==";
          expires = "2027-11-21";
        };
        signing = keyOption "Key that signs commits and tags." {
          label = "grimoire-signing";
          publicKey = "sk-ecdsa-sha2-nistp256@openssh.com AAAAInNrLWVjZHNhLXNoYTItbmlzdHAyNTZAb3BlbnNzaC5jb20AAAAIbmlzdHAyNTYAAABBBLYQMPIMWApDrb3ET6bYuN5WLs+c38CNlUV/ecU6X49Sy/G3Oq1krIPXNNFp0diD/9dvgIW9kx+AhEirNOEVPxQAAAAEc3NoOg==";
          expires = "2027-11-21";
        };
        github = keyOption "Key that authenticates to GitHub, the one remote hosts can use only while it is unlocked." {
          label = "grimoire-github";
          publicKey = "sk-ecdsa-sha2-nistp256@openssh.com AAAAInNrLWVjZHNhLXNoYTItbmlzdHAyNTZAb3BlbnNzaC5jb20AAAAIbmlzdHAyNTYAAABBBDUocTvx3mH51FDxU0y3vkXvoGNCgqgJaQs7VVxmVnl9uryejdcQkbyFNY2FLGNgamIH4x0QW64C4CXOOHYTob8AAAAEc3NoOg==";
          expires = "2027-11-21";
        };
      };
    };

    hjem.always.options.ssh = let
      atom = types.oneOf [types.bool types.int types.str];
      parameters = types.attrsOf (types.either atom (types.listOf atom));
      literal = name: builtins.match ''[^*?!,"[:space:]]+'' name != null;
      hostSet =
        types.addCheck (types.attrsOf parameters) (hosts: lib.all literal (lib.attrNames hosts))
        // {description = "attribute set of SSH parameters named by literal host names, without patterns, negation, lists or whitespace";};
    in {
      hosts = lib.mkOption {
        type = hostSet;
        default = {};
        description = "SSH client parameters by literal host name. A parameter set here takes precedence over `ssh.defaults`; the values of a cumulative parameter such as `IdentityFile` are tried before those of `ssh.defaults`. `true` and `false` render as `yes` and `no`, and a list repeats its parameter.";
      };
      matches = lib.mkOption {
        type = types.attrsOf (types.submodule {
          options = {
            criteria = lib.mkOption {
              type = types.str;
              description = "Criteria of the `Match` line, written as ssh_config(5) reads them.";
            };
            parameters = lib.mkOption {
              type = parameters;
              description = "Parameters applied when the criteria hold, rendered as in `ssh.hosts`.";
            };
          };
        });
        default = {};
        description = "`Match` blocks by name. They precede every block of `ssh.hosts` and `ssh.defaults`, so a parameter they set wins over those, and a cumulative one such as `RemoteForward` is added to theirs. Their order among themselves is unspecified, so two of them do not set the same single-valued parameter.";
      };
      defaults = lib.mkOption {
        type = parameters;
        default = {};
        description = "SSH client parameters for every host; `ssh.hosts` states how a host's own parameters combine with them.";
      };
      rc =
        mylib.fragments.option
        // {
          description = "Fragments of `~/.ssh/rc`, which sshd runs with /bin/sh before the shell or command of every session of this user, whatever the login shell. sshd sends the file's standard output to the client, where it corrupts protocols such as scp and sftp, so a fragment writes nothing there; it also reads nothing from standard input. Without fragments the file is not written.";
        };
    };

    hjem.ifEnabled = {
      config,
      pkgs,
      ...
    }: {
      ssh.hosts."github.com" = {
        HostName = "github.com";
        User = "git";
      };

      ssh.defaults = {
        AddKeysToAgent = true;
        IdentitiesOnly = true;
        UseKeychain = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin true;
        ControlMaster = "auto";
        ControlPath = "~/.ssh/cm-%C";
        ControlPersist = "10m";
        ServerAliveInterval = 30;
        ServerAliveCountMax = 3;
      };

      # ssh takes the first value it obtains for a parameter, so `Host *` comes
      # last.
      files.".ssh/config" = let
        atom = value:
          if lib.isBool value
          then lib.boolToYesNo value
          else toString value;
        block = header: parameters:
          lib.concatLines ([
              header
            ]
            ++ lib.concatLists (lib.mapAttrsToList (key: value: map (item: "  ${key} ${atom item}") (lib.toList value)) parameters));
      in {
        exclusive = true;
        text = lib.concatStringsSep "\n" (lib.mapAttrsToList (_: match: block "Match ${match.criteria}" match.parameters) config.ssh.matches
          ++ lib.mapAttrsToList (host: block "Host ${host}") config.ssh.hosts
          ++ lib.optional (config.ssh.defaults != {}) (block "Host *" config.ssh.defaults));
      };

      files.".ssh/rc" = lib.mkIf (config.ssh.rc != {}) {
        exclusive = true;
        text = mylib.fragments.render config.ssh.rc;
      };

      zsh.zshrc.ssh-key-expiry.text = ''
        () {
          zmodload -F zsh/datetime b:strftime p:EPOCHSECONDS
          local name expires epoch
          for name expires in ${lib.concatStringsSep " " (lib.mapAttrsToList (_: key: "${key.label} ${key.expires}") cfg.keys)}; do
            strftime -r -s epoch '%Y-%m-%d' $expires
            if (( epoch - EPOCHSECONDS < 30 * 86400 )); then
              print -u2 "warning: SSH key $name expires on $expires; rotate it on the key holder and update ssh.keys"
            fi
          done
        }
      '';
    };

    tests.cases = _: let
      lines = result: lib.splitString "\n" result.options.files.value.".ssh/config".text;
      declare = hosts: {declaration.hjem.always.ssh.hosts = hosts;};
    in
      {
        list-repeats-parameter = {
          protects = "a list value writes its parameter once per element, in order";
          modules = declare {"a.example".IdentityFile = ["~/.ssh/fixture-first" "~/.ssh/fixture-second"];};
          expr = result: lib.filter (lib.hasPrefix "  IdentityFile ~/.ssh/fixture-") (lines result);
          expected = ["  IdentityFile ~/.ssh/fixture-first" "  IdentityFile ~/.ssh/fixture-second"];
        };
      }
      // lib.mapAttrs' (name: lib.nameValuePair "rejects-host-${builtins.toJSON name}") (lib.genAttrs ["" "*" "*.example" "host?" "!github.com" "a,b" "a b"] (name: {
        protects = "a key of ssh.hosts is a literal host name, so no two of its blocks match the same host";
        modules = declare {${name}.User = "x";};
        expr = lines;
        fails = true;
      }));
  })
