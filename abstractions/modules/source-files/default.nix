{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: let
  inherit (lib) types;
  file = types.submodule {
    options = {
      source = lib.mkOption {
        type = types.path;
        description = "File that replaces the upstream one.";
      };
      upstreamSha256 = lib.mkOption {
        type = types.strMatching "[0-9a-f]{64}";
        description = "Hex SHA-256 of the upstream file being replaced; a build whose source holds a different file fails, so upstream changes are merged rather than overwritten.";
      };
    };
  };
  source = types.submodule {
    options = {
      package = delib.packageOption null;
      files = lib.mkOption {
        type = types.attrsOf (types.uniq file);
        default = {};
        description = "Files of \`package\`'s source replaced before it is built, keyed by their path relative to the source root. Each path may be replaced by one definition only.";
      };
    };
  };
  apply = {
    package,
    files,
  }:
    if files == {}
    then package
    else
      package.overrideAttrs (old: {
        postPatch =
          (old.postPatch or "")
          + lib.concatStrings (lib.mapAttrsToList (path: file: ''
              if ! echo ${lib.escapeShellArg "${file.upstreamSha256}  ${path}"} | sha256sum --check --status; then
                echo ${lib.escapeShellArg "${path} differs from the upstream file its replacement was written against"} >&2
                exit 1
              fi
              cp ${file.source} ${lib.escapeShellArg path}
            '')
            files);
      });
in {
  name = "source-files";
  meta.description = "Replace whole files of packages' sources before they are built, checked against the upstream files they were written against.";

  options = with delib; {
    sources = lib.mkOption {
      type = types.attrsOf source;
      default = {};
      description = "Packages whose sources features patch, by name, with the files replaced in each.";
    };
    patched = readOnly (defaultText (attrsOfOption types.package (lib.mapAttrs (_: apply) cfg.sources)) (lib.literalMD "each of \`sources\` built with its replaced files, or the package itself without any"));
  };

  tests.cases = {pkgs, ...}: let
    upstream = pkgs.stdenv.mkDerivation {
      name = "source-files-fixture";
      src = pkgs.writeTextDir "file" "upstream\n";
      dontBuild = true;
      installPhase = "cp file $out";
    };
    replacement = pkgs.writeText "file" "replaced\n";
    sources = files: {myconfig.always.source-files.sources.fixture = {package = upstream;} // files;};
    patched = result: result.options.myconfig.source-files.patched.value.fixture;
  in {
    unpatched-package-is-kept = {
      protects = "a package without replaced files is the package itself, so it keeps its binary cache";
      modules.declares = sources {};
      expr = result: (patched result).drvPath;
      expected = upstream.drvPath;
    };
    replacement-is-built = {
      protects = "a replaced file is in the built package when the upstream file matches its recorded hash";
      modules.declares = sources {
        files.file = {
          source = replacement;
          upstreamSha256 = builtins.hashString "sha256" "upstream\n";
        };
      };
      build = result:
        pkgs.runCommand "source-files-replaced" {} ''
          grep -Fx replaced ${patched result}
          touch "$out"
        '';
    };
    changed-upstream-fails = {
      protects = "a replacement written against a different upstream file fails the build instead of overwriting the change";
      modules.declares = sources {
        files.file = {
          source = replacement;
          upstreamSha256 = builtins.hashString "sha256" "other\n";
        };
      };
      build = result:
        pkgs.runCommand "source-files-mismatch" {
          failure = pkgs.testers.testBuildFailure (patched result);
        } ''
          grep -F 'file differs from the upstream file' "$failure/testBuildFailure.log"
          touch "$out"
        '';
    };
    one-definition-per-path = {
      protects = "two features cannot replace the same path";
      modules = {
        first = sources {
          files.file = {
            source = replacement;
            upstreamSha256 = builtins.hashString "sha256" "upstream\n";
          };
        };
        second = {
          myconfig.always.source-files.sources.fixture.files.file = {
            source = pkgs.writeText "file" "other\n";
            upstreamSha256 = builtins.hashString "sha256" "upstream\n";
          };
        };
      };
      expr = result: (patched result).drvPath;
      fails = true;
    };
  };
})
