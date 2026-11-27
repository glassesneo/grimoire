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
  tests.fixture = ["agents" "exclusive"];
  meta.description = "Provide and configure the Google Antigravity CLI.";

  options = with delib; {
    enable = boolOption true;
    unattended = boolOption false "Auto-approve workspace edits, tool calls, and artifact reviews, allow non-workspace access, and keep the terminal sandbox off.";
  };

  hjem.ifEnabled = {pkgs, ...}: let
    settings =
      {
        altScreenMode = "always";
      }
      // lib.optionalAttrs cfg.unattended {
        agentMode = "accept-edits";
        toolPermission = "always-proceed";
        artifactReviewPolicy = "always-proceed";
        allowNonWorkspaceAccess = true;
        enableTerminalSandbox = false;
      };
    settingsFile = pkgs.writeText "antigravity-cli-settings.json" (builtins.toJSON settings);
    # agy normalizes and atomically replaces ~/.gemini/antigravity-cli/settings.json on startup,
    # and trustedWorkspaces matches exact workspace paths rather than "/". Passing --settings
    # dynamically keeps settings.json owned by agy while trusting the launched workspace.
    wrapper = pkgs.writeShellScriptBin "agy" ''
      pwd_logical=$PWD
      pwd_physical=$(pwd -P)
      git_root=$(${lib.getExe pkgs.git} rev-parse --show-toplevel 2>/dev/null || true)
      settings=$(${lib.getExe pkgs.jq} -c \
        --arg a "$pwd_logical" \
        --arg b "$pwd_physical" \
        --arg c "$git_root" \
        '. + {trustedWorkspaces: ([$a, $b, $c] | map(select(. != "")) | unique)}' \
        ${settingsFile})
      exec ${lib.getExe myconfig.agents.packages.antigravity-cli} --settings="$settings" "$@"
    '';
  in {
    packages = [wrapper];

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

  tests.cases = {
    lib,
    pkgs,
    ...
  }: {
    wrapper-passes-settings = {
      protects = "the agy wrapper passes the declared settings and current workspace trust via --settings while keeping the caller's arguments separate";
      build = result: let
        agy = lib.findFirst (path: lib.hasSuffix "-agy" (baseNameOf path)) (throw "missing wrapper") result.packages;
        real = lib.getExe result.options.myconfig.agents.packages.value.antigravity-cli;
      in
        pkgs.runCommand "agy-wrapper" {nativeBuildInputs = [pkgs.jq];} ''
          printf '#!${pkgs.runtimeShell}\nprintf "%%s\\n" "$@"\n' > stub
          chmod +x stub
          substitute ${agy}/bin/agy wrapper --replace-fail ${real} "$PWD/stub"
          mkdir -p "work dir"
          (cd "work dir" && ${pkgs.runtimeShell} "$OLDPWD/wrapper" 'SYNTHETIC PROMPT' --model synthetic) > argv
          test "$(wc -l < argv)" -eq 4
          flag=$(sed -n 1p argv)
          case "$flag" in --settings=\{*) ;; *) cat argv; exit 1 ;; esac
          expected_dir=$(cd "work dir" && pwd -P)
          printf '%s\n' "''${flag#--settings=}" | jq -e --arg dir "$expected_dir" '
            .altScreenMode == "always"
            and (has("toolPermission") | not)
            and (.trustedWorkspaces | index($dir) != null)
          '
          test "$(sed -n 2p argv)" = 'SYNTHETIC PROMPT'
          test "$(sed -n 3,4p argv)" = "$(printf '%s\n' --model synthetic)"
          touch "$out"
        '';
    };
  };
})
