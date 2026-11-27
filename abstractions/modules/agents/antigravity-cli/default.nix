{
  delib,
  lib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "antigravity-cli";
  meta.description = "Provide and configure the Google Antigravity CLI.";

  options = with delib; {
    enable = boolOption true;
    unattended = boolOption false "Auto-approve workspace edits, tool calls, and artifact reviews, allow non-workspace access, and keep the terminal sandbox off.";
  };

  hjem.ifEnabled = {
    packages = [myconfig.agents.packages.antigravity-cli];

    files.".gemini/antigravity-cli/settings.json" = {
      exclusive = true;
      generator = lib.generators.toJSON {};
      value =
        {
          "$schema" = "https://antigravity.google/schemas/v1/settings.json";
          altScreenMode = "always";
        }
        // lib.optionalAttrs cfg.unattended {
          agentMode = "accept-edits";
          toolPermission = "always-proceed";
          artifactReviewPolicy = "always-proceed";
          allowNonWorkspaceAccess = true;
          enableTerminalSandbox = false;
        };
    };

    files.".gemini/antigravity-cli/keybindings.json" = {
      exclusive = true;
      generator = lib.generators.toJSON {};
      value = {
        "cli.clear_screen" = [];
        "prompt.insert_newline" = ["shift+enter"];
        "subagent.jump_to_waiting" = [];
        "subagent.approve_fast" = [];
        "navigation.up" = ["up" "ctrl+p"];
        "navigation.down" = ["down" "ctrl+n"];
      };
    };
  };
})
