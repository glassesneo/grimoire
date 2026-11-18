{
  pkgs,
  lib,
  pi,
}: let
  settings = pkgs.writeText "ai-mop-settings.json" (builtins.toJSON {
    defaultProvider = "ai-mop-responses";
    defaultModel = "gpt-6-astra";
    enabledModels = ["ai-mop-*/*"];
    defaultTools = ["echo" "sha256"];
    defaultProjectTrust = "never";
    retry = {
      enabled = false;
      provider.maxRetries = 0;
    };
    compaction.enabled = false;
    cacheWarming = "off";
  });
in
  pkgs.writeShellScriptBin "ai-mop" ''
    set -eu
    umask 077
    agent_dir=$(${pkgs.coreutils}/bin/mktemp -d "''${TMPDIR:-/tmp}/ai-mop.XXXXXXXX")
    trap '${pkgs.coreutils}/bin/rm -rf "$agent_dir"' EXIT
    ${pkgs.coreutils}/bin/cp ${settings} "$agent_dir/settings.json"
    if [ -n "''${AI_MOP_MODELS_FILE:-}" ]; then
      ${pkgs.coreutils}/bin/cp "$AI_MOP_MODELS_FILE" "$agent_dir/models.json"
    fi
    export PI_CODING_AGENT_DIR="$agent_dir"
    export PI_CODING_AGENT_SESSION_DIR="''${AI_MOP_STATE_DIR:-''${XDG_STATE_HOME:-$HOME/.local/state}/grimoire/ai-mop}/sessions"
    export PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
    ${lib.getExe pi} \
      --no-approve --no-context-files --no-extensions --no-mcp \
      --no-skills --no-prompt-templates --no-themes \
      --extension ${./src}/extension.ts \
      --system-prompt 'You are an assistant for trying language models. Answer the user directly. Use the available tools when requested or useful.' \
      "$@"
  ''
