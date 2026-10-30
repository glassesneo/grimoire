# A Denix declaration option without a description.
{lib, ...}: {
  config.settings.modules.extraSubmodules.options.undocumented = lib.mkOption {
    type = lib.types.str;
    default = "";
  };
}
