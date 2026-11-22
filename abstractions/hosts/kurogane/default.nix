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
    vfkit.enable = true;
    vfkit.persistence.enable = true;
    tailscale.enable = true;
    ssh.remote.enable = true;
    slack.enable = false;
    notion.enable = false;
    web.enable = true;
    pi.mcpServers = ["web"];
    edith = {
      enable = true;
      resident.enable = true;
      # Both profiles grant the same for now; they diverge once tools beyond web search exist.
      profiles = let
        profile = {
          model = {
            provider = "openai";
            modelId = "gpt-6.2-sol";
          };
          thinkingLevel = "medium";
          tools = ["read" "write"];
          mcpServers = ["web"];
          maxTurns = null;
        };
      in {
        full = profile;
        restricted = profile;
      };
      namespaces = {
        cli = "full";
        discord = "restricted";
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

  darwin.ifEnabled = _: {
    system.stateVersion = 7;
    ids.gids.nixbld = 350;
    services.openssh.enable = true;

    # Requires FileVault to be off and automatic login credentials to be
    # registered in System Settings; no account password belongs in the store.
    system.defaults.loginwindow.autoLoginUser = "neo";

    # Idle-sleep settings do not prevent lid sleep without an external display.
    # This undocumented, system-wide flag also prevents manual sleep on battery.
    # Removing this declaration does not reset it: run pmset -a disablesleep 0.
    system.activationScripts.postActivation.text = ''
      /usr/bin/pmset -a disablesleep 1
    '';
  };
}
