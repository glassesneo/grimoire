{pkgs, ...}: let
  inherit (pkgs) lib;
  mylib = import ../../lib {inherit lib;};

  upstream = "upstream\n";
  package = pkgs.stdenv.mkDerivation {
    name = "source-files-fixture";
    src = pkgs.writeTextDir "file" upstream;
    dontBuild = true;
    installPhase = "cp file $out";
  };
  replacement = pkgs.writeText "file" "replaced\n";

  # Replacement definitions go through the option so its merge rules apply.
  evaluate = modules:
    (lib.evalModules {
      modules = [{options.files = mylib.sourceFiles.option "package";}] ++ modules;
    }).config.files;
  files = upstreamSha256:
    evaluate [
      {
        files.file = {
          source = replacement;
          inherit upstreamSha256;
        };
      }
    ];

  mismatched = mylib.sourceFiles.apply package (files (builtins.hashString "sha256" "other\n"));
in {
  check =
    pkgs.runCommand "source-files-test" {
      failure = pkgs.testers.testBuildFailure mismatched;
    } ''
      grep -F 'file differs from the upstream file' "$failure/testBuildFailure.log"
      mkdir "$out"
    '';
}
