{delib, ...}:
delib.module ({cfg, ...}: {
  name = "appcleaner";
  tests.fixture = ["exclusive"];
  meta = {
    description = "Provide AppCleaner.";
    tags = ["gui"];
  };

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption false;
      package = packageOption pkgs.appcleaner;
    };

  hjem.ifEnabled = {
    nixpkgs.config.allowUnfreePackages = ["appcleaner"];

    files."Applications/AppCleaner.app" = {
      exclusive = true;
      source = "${cfg.package}/Applications/AppCleaner.app";
    };
  };
})
