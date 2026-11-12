# Builds a check that type-checks and lints one TypeScript directory. `types`
# is a Bun project directory (package.json, bun.lock and the bun.nix that
# `just bun` writes) whose packages provide the types `src` imports; `src` is
# checked strictly with Node module resolution and the repository's oxlint
# configuration, which fails on warnings.
{
  pkgs,
  bun2nix,
  oxlintConfig,
}: {
  name,
  src,
  types,
}: let
  tsconfig = pkgs.writeText "tsconfig.json" (builtins.toJSON {
    compilerOptions = {
      target = "ES2024";
      module = "NodeNext";
      moduleResolution = "NodeNext";
      strict = true;
      noEmit = true;
      allowImportingTsExtensions = true;
      resolveJsonModule = true;
      skipLibCheck = true;
      types = ["node"];
    };
    include = ["src"];
  });
in
  bun2nix.mkDerivation {
    pname = "${name}-typescript";
    version = "0";
    src = pkgs.runCommand "${name}-typescript-src" {} ''
      mkdir -p "$out"
      cp ${types + "/package.json"} "$out/package.json"
      cp ${types + "/bun.lock"} "$out/bun.lock"
      cp ${tsconfig} "$out/tsconfig.json"
      cp -r ${src} "$out/src"
    '';
    bunDeps = bun2nix.fetchBunDeps {bunNix = types + "/bun.nix";};
    nativeBuildInputs = [pkgs.nodejs pkgs.oxlint pkgs.tsgolint];
    buildPhase = ''
      node node_modules/typescript/bin/tsc -p .
      oxlint --config ${oxlintConfig} --tsconfig tsconfig.json --deny-warnings src
    '';
    installPhase = ''touch "$out"'';
  }
