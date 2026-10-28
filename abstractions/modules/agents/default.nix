{
  delib,
  inputs,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "agents";
  meta.description = "Provide a shared configuration interface for LLM agents and configure the selected agent packages.";

  options = {
    packages = delib.readOnly (delib.lazyAttrsOfOption delib.types.package inputs.llm-agents.packages.${myconfig.host.system} {
      defaultText = lib.literalExpression "inputs.llm-agents.packages.\${myconfig.host.system}";
      description = "Agent packages of llm-agents.nix for the host's system, by name.";
    });
  };
})
