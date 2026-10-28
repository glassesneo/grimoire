{delib, ...}:
delib.host {
  name = "kurogane";
  system = "aarch64-darwin";
  user.name = "neo";

  myconfig.ifEnabled = {
    tags.enabled = ["gui"];
    slack.enable = false;
    notion.enable = false;
    shell.loginShell = "zsh";
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
