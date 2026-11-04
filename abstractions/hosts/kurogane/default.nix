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
  };
}
