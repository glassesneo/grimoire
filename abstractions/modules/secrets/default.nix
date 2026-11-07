{
  delib,
  lib,
  mylib,
  ...
}: let
  # Every `<name>.enc` stored in this module.
  secretNames = map (lib.removeSuffix ".enc") (builtins.filter (lib.hasSuffix ".enc") (builtins.attrNames (builtins.readDir ./storage)));
in
  delib.module ({cfg, ...}: {
    name = "secrets";
    tests.fixture = ["nix-secrets" "zsh"];
    meta.description = "Manage the selected encrypted secrets with nix-secrets.";

    options = with delib; {
      enable = boolOption true;
      names = listOfOption (types.enum secretNames) [] "Secrets, among those stored in this module, that are decrypted for the user.";
      required = mylib.accumulatingOption (listOfOption (types.enum secretNames) [] "Secrets that modules decrypt for the user whatever `names` selects.");
    };

    hjem.ifEnabled = {
      config,
      pkgs,
      ...
    }: let
      selected = lib.unique (cfg.names ++ cfg.required);
      # Each secret path is a link into the RAM disk, dangling once a reboot discards it.
      probe = config.security.nix-secrets.secrets.${builtins.head selected}.path;
      logDir = "${config.xdg.state.directory}/nix-secrets";
    in {
      security.nix-secrets = {
        enable = true;
        storage = ./storage;
        identityPaths = ["${config.xdg.config.directory}/sops/age/keys.txt"];
        defaultRecipients = [
          "age1r990kv2jq2vd4fxhf6znzmqqg6w2wfhllw9s9uzjun6tvcd43e3san06yu"
          "age1jaf2jhvqsvdrwr5purlmea0uy0jauw000pllpz6ehe5eq5edg5dqc2dscd"
          "age1cwfytgvhlf23kxyt4r4et76uwva9jpudy7kdjgpgwtu287cvrawsw09t73"
          "age1fghhv0qqjj0z34cwru7xlepyechw8vsc2tz0zs4ug8ke3el34g3q5zmwwk"
        ];
        secrets = lib.genAttrs selected (_: {});
      };

      # SSH sessions do not load the login LaunchAgent.
      zsh.zshenv.nix-secrets = lib.mkIf (pkgs.stdenv.hostPlatform.isDarwin && selected != []) {
        text = ''
          if [ ! -e ${lib.escapeShellArg probe} ]; then
            mkdir -p ${lib.escapeShellArg logDir}
            ${config.security.nix-secrets.activateScript} >>${lib.escapeShellArg "${logDir}/activate.log"} 2>&1
          fi
        '';
      };
    };
  })
