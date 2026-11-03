{pkgs, ...}: let
  lib = pkgs.lib;
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

  replaced = mylib.sourceFiles.apply package (files (builtins.hashString "sha256" upstream));
  mismatched = mylib.sourceFiles.apply package (files (builtins.hashString "sha256" "other\n"));
  conflicting = evaluate [
    {
      files.file = {
        source = replacement;
        upstreamSha256 = builtins.hashString "sha256" upstream;
      };
    }
    {
      files.file = {
        source = package;
        upstreamSha256 = builtins.hashString "sha256" upstream;
      };
    }
  ];
in {
  check = assert lib.assertMsg ((mylib.sourceFiles.apply package {}).drvPath == package.drvPath)
  "Without replacements the package must stay the same derivation";
  assert lib.assertMsg (!(builtins.tryEval (builtins.deepSeq conflicting conflicting)).success)
  "Two definitions replacing one path must conflict";
    pkgs.runCommand "source-files-test" {
      failure = pkgs.testers.testBuildFailure mismatched;
    } ''
      grep -Fx replaced ${replaced}
      grep -F 'file differs from the upstream file' "$failure/testBuildFailure.log"
      mkdir "$out"
    '';
}
