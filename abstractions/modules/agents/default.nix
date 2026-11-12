{
  delib,
  inputs,
  ...
}:
delib.module {
  name = "agents";
  meta.description = "Provide a shared configuration interface for LLM agents and configure the selected agent packages.";

  options = {pkgs, ...}: {
    packages = delib.readOnly (delib.lazyAttrsOfOption delib.types.package inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system} "Agent packages of llm-agents.nix for the evaluation's system, by name.");
  };

  # llm-agents.nix pushes its builds to this cache; they stay substitutable
  # while the flake input keeps its own nixpkgs.
  darwin.always.nix.settings = {
    extra-substituters = ["https://cache.numtide.com"];
    extra-trusted-public-keys = ["niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g="];
  };
}
