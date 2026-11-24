{lib}: let
  inherit (lib) types;
in {
  option = packageOption:
    lib.mkOption {
      type = types.attrsOf (types.uniq (types.submodule {
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
      }));
      default = {};
      description = "Files of `${packageOption}`'s source replaced before it is built, keyed by their path relative to the source root. Each path may be replaced by one definition only.";
    };

  apply = package: files:
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
}
