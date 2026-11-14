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
    slack.enable = false;
    notion.enable = false;
    web.enable = true;
    pi.mcpServers = ["web"];
    secrets.names = [
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

  darwin.ifEnabled = {
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
