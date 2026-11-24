{
  delib,
  lib,
  ...
}:
delib.host {
  name = "seiran";
  system = "aarch64-darwin";
  user.name = "neo";
  rice = "default";

  myconfig.ifEnabled = {
    tags.enabled = ["gui"];
    aquaskk = {
      enable = true;
      directClients = [];
    };
    omniwm = {
      enable = true;
      settings = {
        monitorGapOverrides = [
          {
            id = "FF625DFC-6800-19E6-24BD-61551D8E9DB6";
            monitorDisplayUUID = "37D8832A-2D66-02CA-B9F7-8F30A301B230";
            monitorName = "Built-in Retina Display";
            outerGapTop = 17.0;
          }
        ];
      };
    };
    kanata = {
      enable = true;
      profile = "default";
      layers.base = lib.mapAttrs (key: action: ["fork" action key ["fn"]]) {
        f1 = "brdn";
        f2 = "brup";
        f3 = "mctl";
        f4 = "sls";
        f5 = "dtn";
        f6 = "dnd";
        f7 = "prev";
        f8 = "pp";
        f9 = "next";
        f10 = "mute";
        f11 = "vold";
        f12 = "volu";
      };
    };
    ghostty.settings = {
      font-size = 16;
      background-opacity = 0.34;
      background-blur = 2;
      window-padding-x = 8;
      window-padding-y = 6;
    };
    rex = {
      fontSize = 16;
      paddingX = 0;
      paddingY = 0;
    };
    vicinae = {
      compact-transition.enable = true;
      selection-highlight.enable = true;
    };
    tailscale.enable = true;
    tart.enable = true;
    spicetify.enable = true;
    ssh.keyholder = {
      enable = true;
      remoteHosts = ["kurogane" "seiran-vm1"];
    };
    web.enable = true;
    pi.mcpServers = ["web"];
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

  hjem.ifEnabled = {config, ...}: {
    ssh.hosts.kurogane = {
      HostName = "kurogane.${config.myconfig.tailscale.tailnet}";
      User = "neo";
    };
  };

  darwin.ifEnabled = {config, ...}: {
    system.stateVersion = 4;
    ids.gids.nixbld = 350;

    users.users.neo.openssh.authorizedKeys.keys = [
      ''from="192.168.64.0/24",restrict,command="${config.nix.package}/bin/nix-daemon --stdio" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHCXv3HHggPxbwTFYFTK8eZcTjUyi1bWQyUVH1rjhfaj root@seiran-vm1''
    ];
  };
}
