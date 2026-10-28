# Owns the Hjem module system and the contract of its result.
#
# `makeSystem` evaluates one user's Hjem configuration and returns the manifest,
# the packages, `apply`, and a `preflight` derivation that realizes all file,
# package and apply closures. `apply` runs, with bin/apply, every program
# registered in `applySteps`; its `steps` passthru exposes them by name for
# evaluation checks. Assertions block every output except `failedAssertions`,
# the messages of the failed ones, which module checks read without forcing an
# output, and `options`, the evaluated option declarations that generated
# references read.
#
# `pkgs` is Nixpkgs for the user's system. `nixpkgs.config.allowUnfreePackages`
# names the unfree packages it may evaluate; every other unfree package fails
# evaluation.
{inputs, ...}: {
  moduleSystems.hjem = {
    flakeOutputs = {
      modules = null;
      systems = null;
    };

    makeSystem = {
      modules,
      extraArgs,
      ...
    }: let
      inherit (extraArgs) system username homeDirectory;
      lib = inputs.nixpkgs.lib;
      pkgs = inputs.nixpkgs.legacyPackages.${system};
      hjemLib = inputs.hjem."hjem-lib".${system};

      fileSetPaths = [
        ["files"]
        ["xdg" "cache" "files"]
        ["xdg" "config" "files"]
        ["xdg" "data" "files"]
        ["xdg" "state" "files"]
      ];

      # Mirrors nix-darwin's `nixpkgs.config.allowUnfreePackages`, so a module
      # allows the unfree packages it uses beside the use.
      unfreePackages = {
        _file = ./default.nix;
        options.nixpkgs.config.allowUnfreePackages = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [];
          description = "Names of unfree packages that `pkgs` may evaluate; definitions from every module are merged.";
        };
      };

      applySteps = {
        _file = ./default.nix;
        options.applySteps = lib.mkOption {
          type = lib.types.attrsOf lib.types.package;
          default = {};
          description = "Packages whose bin/apply the switch runs after Hjem activates files and packages. Steps run one at a time and the switch stops at the first failure; their order is unspecified, so a step does not rely on another having run.";
        };
      };

      evaluation = lib.evalModules {
        class = "hjem";

        # Hjem imports from `pkgs.path`, so `pkgs` must be a special argument;
        # the list stays lazy, so importing does not force the configuration.
        specialArgs = {
          pkgs = import inputs.nixpkgs {
            inherit system;
            config.allowUnfreePackages = evaluation.config.nixpkgs.config.allowUnfreePackages;
          };
          "hjem-lib" = hjemLib;
        };

        modules =
          [
            "${inputs.hjem.outPath}/modules/common/user.nix"
            {
              _module.args.name = username;
              user = username;
              directory = homeDirectory;
              clobberFiles = false;
            }
            unfreePackages
            applySteps
            # standalone applies packages through current-profile; expose it on PATH.
            ({config, ...}: {
              environment.sessionVariables.PATH = lib.mkMerge [
                (lib.mkBefore ["${config.xdg.state.directory}/hjem/standalone/current-profile/bin"])
                (lib.mkAfter ["$PATH"])
              ];
            })
          ]
          ++ modules;
      };

      cfg = evaluation.config;

      fileSets = map (path: lib.getAttrFromPath path cfg) fileSetPaths;

      enabledFiles =
        lib.concatMap
        (attrs:
          lib.filter (file: file.enable)
          (builtins.attrValues attrs))
        fileSets;

      sources =
        lib.filter
        (source: source != null)
        (map (file: file.source) enabledFiles);

      apply =
        pkgs.runCommand "hjem-apply" {
          passthru.steps = cfg.applySteps;
        } ''
          mkdir -p "$out/bin"
          cat > "$out/bin/apply" <<'EOF'
          #!${pkgs.runtimeShell}
          set -e
          ${lib.concatMapStringsSep "\n" (step: lib.escapeShellArg "${step}/bin/apply") (builtins.attrValues cfg.applySteps)}
          EOF
          chmod +x "$out/bin/apply"
        '';

      dependencies = sources ++ cfg.packages ++ [apply];

      preflight =
        pkgs.runCommand
        "hjem-preflight"
        {
          # Structured attrs keep store paths containing spaces, such as app bundles, intact.
          __structuredAttrs = true;
          inherit dependencies;
        }
        ''
          for dependency in "''${dependencies[@]}"; do
            test -e "$dependency"
            printf '%s\n' "$dependency"
          done > "$out"
        '';

      # Hjem's per-user module imports nixpkgs' assertions module, so `assertions`
      # is already declared in this evaluation.
      failedAssertions = map (x: x.message) (lib.filter (x: !x.assertion) cfg.assertions);

      throwAssertions = res:
        if failedAssertions != []
        then throw "\nFailed assertions:\n${lib.concatStringsSep "\n" (map (x: "- ${x}") failedAssertions)}"
        else res;
    in
      lib.mapAttrs (_: throwAssertions) {
        manifest = {
          version = 3;
          files = map hjemLib.fileToJson enabledFiles;
        };

        packages = map toString cfg.packages;

        inherit preflight apply;
      }
      // {
        inherit failedAssertions;
        inherit (evaluation) options;
      };
  };
}
