{
  lib,
  documented,
  root ? null,
}: let
  read = file: let
    data = lib.importJSON file;
  in
    if data.version or null == 8
    then data.pins
    else throw "${toString file}: npins lock format version ${toString (data.version or "unknown")} is unsupported; anchors read version 8";

  fetch = file: name: pin: let
    unsupported = reason: throw "${toString file}: pin `${name}` ${reason}; anchors fetch Git pins with a tarball URL and URL pins";
    tarball = builtins.fetchTree {
      type = "tarball";
      inherit (pin) url;
      narHash = pin.hash;
    };
  in
    if lib.elem pin.type ["Git" "GitRelease"]
    then
      if pin.submodules or false
      then unsupported "fetches submodules"
      else if pin.url or null == null
      then unsupported "records no tarball URL"
      else
        tarball
        // {
          rev = pin.revision;
          shortRev = builtins.substring 0 7 pin.revision;
        }
        // lib.optionalAttrs (pin.type == "GitRelease") {inherit (pin) version;}
    else if pin.type == "Url"
    then
      if pin.unpack
      then tarball
      else {
        outPath = builtins.fetchurl {
          inherit (pin) url;
          sha256 = pin.hash;
          # Programs loading the file may read its name.
          name = baseNameOf pin.url;
        };
      }
    else unsupported "has type ${pin.type}";

  flake = file: name: pin:
    if lib.elem pin.type ["Git" "GitRelease"] && pin.repository.type == "GitHub"
    then builtins.getFlake "github:${pin.repository.owner}/${pin.repository.repo}/${pin.revision}?narHash=${lib.escapeURL pin.hash}"
    else throw "${toString file}: pin `${name}` is not a GitHub repository; anchors evaluate GitHub pins as flakes";

  discover = directory:
    lib.listToAttrs (map (file: lib.nameValuePair (lib.removePrefix "${toString directory}/" (toString (dirOf file))) file)
      (lib.fileset.toList (lib.fileset.fileFilter (file: file.name == "anchors.json") directory)));

  anchorsOf = file: let
    pins = read file;
  in {
    sources = lib.mapAttrs (fetch file) pins;
    flakes = lib.mapAttrs (flake file) pins;
  };
  memo = lib.optionalAttrs (root != null) (lib.mapAttrs' (_: file: lib.nameValuePair (toString file) (anchorsOf file)) (discover root));
  of = file: memo.${toString file} or (anchorsOf file);
in {
  inherit discover;
  sources = documented {
    description = "The pins of an npins lock file (format version 8, written by `just anchors update`) by name, each as a source whose `outPath` is the pin's content, fetched during evaluation and checked against its recorded hash. A Git or GitHub pin also carries `rev`, `shortRev`, `lastModified`, `lastModifiedDate` and `narHash`, and a release its tag as `version`, as a flake input of the same revision does. A URL pin is a single file keeping its name, unpacked when npins records `unpack`. Other pin types and Git pins with submodules fail.";
    arguments.file = "The module's `anchors.json`.";
  } (file: (of file).sources);
  flakes = documented {
    description = "The GitHub pins of an npins lock file by name, each evaluated as a flake with its own lock file, as a flake input of the same revision.";
    arguments.file = "The module's `anchors.json`.";
  } (file: (of file).flakes);
}
