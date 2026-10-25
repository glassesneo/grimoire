{
  delib,
  inputs,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "casks";
  meta.description = "Expose the official Homebrew casks, packaged by brew-nix, to modules.";

  options = {
    packages = delib.readOnly (delib.lazyAttrsOfOption delib.types.package (inputs.brew-nix.lib.mkCasks {
      pkgs = inputs.nixpkgs.legacyPackages.${myconfig.host.system};
      source = inputs.brew-api;
    }));
  };
})
