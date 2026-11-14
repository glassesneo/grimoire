{delib, ...}:
delib.module {
  name = "vfkit";
  meta.description = "Provide vfkit for running virtual machines with Apple Virtualization.framework.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.vfkit];
  };
}
