{
  delib,
  lib,
  mylib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "ssh";
  tests.fixture = ["exclusive"];
  meta.description = "Configure the OpenSSH client, the user's personal key, and the commands sshd runs as the user at the start of each session.";

  options = with delib; {
    enable = boolOption true;
    personalKeyFile = readOnly (description (strOption "~/.ssh/id_ed25519_personal") "Path of the personal SSH private key on each host, used for GitHub authentication and Git commit signing.");
  };

  hjem.always.options.ssh = let
    inherit (lib) types;
    atom = types.oneOf [types.bool types.int types.str];
    parameters = types.attrsOf (types.either atom (types.listOf atom));
    # A literal name matches only itself, so no two blocks of `hosts` apply to
    # the same host and their order cannot matter.
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
      IdentityFile = cfg.personalKeyFile;
    };

    ssh.defaults = {
      AddKeysToAgent = true;
      IdentitiesOnly = true;
      UseKeychain = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin true;
    };

    # ssh uses the first value it obtains for a parameter, so `Host *` comes
    # after every host's block.
    files.".ssh/config" = let
      atom = value:
        if lib.isBool value
        then lib.boolToYesNo value
        else toString value;
      block = pattern: parameters:
        lib.concatLines ([
            "Host ${pattern}"
          ]
          ++ lib.concatLists (lib.mapAttrsToList (key: value: map (item: "  ${key} ${atom item}") (lib.toList value)) parameters));
    in {
      exclusive = true;
      text =
        lib.concatStringsSep "\n" (lib.mapAttrsToList block config.ssh.hosts
          ++ lib.optional (config.ssh.defaults != {}) (block "*" config.ssh.defaults));
    };

    files.".ssh/rc" = lib.mkIf (config.ssh.rc != {}) {
      exclusive = true;
      text = mylib.fragments.render config.ssh.rc;
    };
  };

  tests.cases = _: let
    lines = result: lib.splitString "\n" result.options.files.value.".ssh/config".text;
    declare = hosts: {declaration.hjem.always.ssh.hosts = hosts;};
  in
    {
      # No published host declares a list.
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
