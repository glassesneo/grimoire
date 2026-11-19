{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "neovim.ai-completion";
  tests.fixture = ["neovim"];
  meta.description = "Provide switchable inline AI completions through Minuet.";

  options = with delib; {
    enable = boolOption true;
    model = strOption "gpt-6.2-sol" "OpenAI-compatible model used at startup.";
    endpoint = strOption "https://api.openai.iniad.org/api/v1/chat/completions" "Endpoint for the OpenAI-compatible choice.";
    anthropic.model = strOption "claude-sonnet-5-5";
    anthropic.endpoint = strOption "https://api.anthropic.iniad.org/api/v1/messages";
  };

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}: {
    plugins.start = [pkgs.vimPlugins.minuet-ai-nvim];
    extraBinPath = [pkgs.curl];
    initLua = ''
      vim.g.grimoire_ai_completion = ${lib.generators.toLua {} {inherit (cfg) model endpoint anthropic;}}
    '';
    plugins.dev.grimoire-ai-completion = {
      pure = ./config;
      impure = "~/grimoire/abstractions/modules/neovim/ai-completion/config";
    };
  };

  tests.cases = {
    pkgs,
    lib,
    ...
  }: let
    check = name: file: result:
      pkgs.runCommand name {} ''
        export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
        export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
        mkdir -p "$HOME"
        ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${file}"); if not ok then print(err); vim.cmd("cquit") end'
        touch "$out"
      '';
  in {
    outbound-privacy = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "automatic and manual requests exclude env-named, unresolved, unlisted and special buffers without excluding ordinary config, local and private filenames; credentials are read at runtime";
      build = check "minuet-outbound-privacy" ./tests/privacy.lua;
    };
    provider-routing = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "switching providers routes requests to the declared model and endpoint with runtime credentials, and can return to the startup provider";
      host.myconfig.ifEnabled.neovim.ai-completion = {
        model = "synthetic-openai";
        endpoint = "https://openai.invalid/completions";
        anthropic.model = "synthetic-anthropic";
        anthropic.endpoint = "https://anthropic.invalid/messages";
      };
      build = check "minuet-provider-routing" ./tests/providers.lua;
    };
    candidate-navigation = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "Ctrl-comma and Ctrl-period dispatch to Minuet's previous and next actions even before a candidate is visible, but do not trigger Minuet without credentials or in excluded buffers";
      build = check "minuet-candidate-navigation" ./tests/navigation.lua;
    };
    inline-acceptance = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "Ctrl-E accepts a visible Minuet suggestion before native inline completion, and otherwise retains native acceptance and end-of-line fallback";
      build = check "minuet-inline-acceptance" ./tests/acceptance.lua;
    };
  };
})
