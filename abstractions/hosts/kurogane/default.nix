{delib, ...}:
delib.host {
  name = "kurogane";
  system = "aarch64-darwin";
  user.name = "neo";
  rice = "default";

  myconfig.ifEnabled = {
    tags.enabled = ["gui"];
    kanata = {
      enable = true;
      profile = "default";
    };
    tailscale.enable = true;
    ssh.remote.enable = true;
    slack.enable = false;
    notion.enable = false;
    web.enable = true;
    pi.mcpServers = ["web"];
    edith = {
      enable = true;
      resident.enable = true;
      access = {
        full = {
          tools = ["read" "write" "edit" "bash"];
          mcpServers = ["web"];
          maxTurns = null;
        };
        restricted = {
          tools = ["read" "write" "edit"];
          mcpServers = ["web"];
          maxTurns = null;
        };
      };
      personas.edith = {
        model = {
          provider = "openai";
          modelId = "gpt-6.2-sol";
        };
        thinkingLevel = "medium";
      };
      namespaces = {
        cli.access = "full";
        discord.access = "restricted";
      };
      providers = ["openrouter"];
      toolUser.loginKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKdeGFni0r9owhP5wTpq3HuBsnA6ra/iH+9vEzoVr203 edith-tools@kurogane";
      discord = {
        enable = true;
        allowedUsers = ["594106068544782338"];
      };
    };
    secrets.names = [
      "ai-mop-api-key"
      "vercel-ai-gateway-api-key"
      "openrouter-api-key"
      "opencode-api-key"
      "mistral-api-key"
      "zai-api-key"
      "cohere-api-key"
      "brave-api-key"
      "brave-free-api-key"
      "parallel-api-key"
      "exa-api-key"
      "command-code-api-key"
    ];
  };

  darwin.ifEnabled = {config, ...}: {
    system.stateVersion = 7;
    ids.gids.nixbld = 350;
    services.openssh.enable = true;

    system.defaults.loginwindow.autoLoginUser = "neo";

    # Idle-sleep settings do not prevent lid sleep without an external display.
    # The flag also prevents manual sleep on battery, and removing this does not
    # reset it: run `pmset -a disablesleep 0`.
    system.activationScripts.postActivation.text = ''
      /usr/bin/pmset -a disablesleep 1
      if /usr/bin/fdesetup isactive >/dev/null; then
        echo "warning: FileVault is on, so automatic login as ${config.system.defaults.loginwindow.autoLoginUser} does not happen" >&2
      elif [ ! -e /etc/kcpassword ]; then
        echo "warning: automatic login as ${config.system.defaults.loginwindow.autoLoginUser} has no password registered; set it in System Settings > Users & Groups" >&2
      fi
    '';
  };
}
