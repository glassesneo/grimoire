# EDITH's sources with their installed dependencies, run by Node.js with type stripping.
# `aiMop` is the directory of AI MOP's `providers.ts`, placed at `src/ai-mop/`.
{
  lib,
  bun2nix,
  aiMop,
}:
bun2nix.mkDerivation {
  pname = "edith";
  version = "0";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [./package.json ./bun.lock ./src];
  };
  bunDeps = bun2nix.fetchBunDeps {bunNix = ./bun.nix;};
  buildPhase = "true";
  installPhase = ''
    mkdir -p "$out/lib"
    cp -r package.json node_modules src "$out/lib/"
    mkdir -p "$out/lib/src/ai-mop"
    cp ${aiMop}/providers.ts "$out/lib/src/ai-mop/"
  '';
}
