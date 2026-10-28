{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "slack";
  meta = {
    description = "Provide the Slack desktop app.";
    tags = ["gui"];
  };

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption false;
      package = packageOption pkgs.slack {defaultText = lib.literalExpression "pkgs.slack";};
    };

  hjem.ifEnabled = {
    nixpkgs.config.allowUnfreePackages = ["slack"];

    files."Applications/Slack.app" = {
      exclusive = true;
      source = "${cfg.package}/Applications/Slack.app";
    };
  };

  # Placed for manual installation from System Settings; profiles cannot be
  # installed non-interactively.
  darwin.ifEnabled = {pkgs, ...}: {
    environment.etc."slack-no-autoupdate.mobileconfig".source = (pkgs.formats.plist {}).generate "slack-no-autoupdate.mobileconfig" {
      PayloadType = "Configuration";
      PayloadVersion = 1;
      PayloadIdentifier = "local.slack.no-autoupdate";
      PayloadUUID = "23078EE5-9182-4AEC-9866-D1D81F76907D";
      PayloadDisplayName = "Disable Slack Auto Update";

      PayloadContent = [
        {
          PayloadType = "com.tinyspeck.slackmacgap";
          PayloadVersion = 1;
          PayloadIdentifier = "local.slack.no-autoupdate.preferences";
          PayloadUUID = "9475B85E-42D2-4DB5-B86C-4A7723BE55A1";
          PayloadDisplayName = "Slack Preferences";

          AutoUpdate = false;
        }
      ];
    };
  };
})
