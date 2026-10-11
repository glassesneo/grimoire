{
  delib,
  inputs,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "harness";
  meta.description = "Provide and configure the repository's own LLM agent harness.";

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption true;
      settings = attrsOfOption anything {
        packages = ["npm:@commandcode/pi-commandcode-provider@0.3.0"];
        defaultProvider = "openai";
        defaultModel = "gpt-6.1-sol";
        defaultTools = ["+codemode"];
        codemode.mode = "only";
      };
      package = packageOption (pkgs.callPackage ./package.nix {
        bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
        inherit (cfg) settings;
      });
    };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: {
    packages = [
      cfg.package
    ];
    xdg.config.files."harness/models.json" = lib.mkIf (config.security.nix-secrets.secrets ? command-code-api-key) {
      generator = builtins.toJSON;
      value.providers.command-code.apiKey = "!${lib.getExe' pkgs.coreutils "cat"} ${lib.escapeShellArg config.security.nix-secrets.secrets.command-code-api-key.path}";
    };
  };

  bundles.ifEnabled.harness = {
    inherit (cfg) package;
  };
})
