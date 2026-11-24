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
      mylib = import ../../lib {inherit lib;};
      pkgs = inputs.nixpkgs.legacyPackages.${system};
      hjemLib = inputs.hjem."hjem-lib".${system};

      fileSetPaths = [
        ["files"]
        ["xdg" "cache" "files"]
        ["xdg" "config" "files"]
        ["xdg" "data" "files"]
        ["xdg" "state" "files"]
      ];

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
          type = lib.types.attrsOf (lib.types.submodule {
            options = {
              package = lib.mkOption {
                type = lib.types.package;
                description = "Package whose bin/apply the step runs.";
              };
              after = lib.mkOption {
                type = lib.types.listOf lib.types.str;
                default = [];
                description = "Registered steps that run before this one.";
              };
              before = lib.mkOption {
                type = lib.types.listOf lib.types.str;
                default = [];
                description = "Registered steps that run after this one.";
              };
            };
          });
          default = {};
          description = "Steps the switch runs after Hjem activates files and packages. Steps run one at a time and the switch stops at the first failure; a step that relies on another having run declares it in `after` or `before`, and the order of steps without such a declaration is stable but unspecified.";
        };
      };

      evaluation = lib.evalModules {
        class = "hjem";

        # Hjem imports from `pkgs.path`, so `pkgs` must be a special argument.
        # Without unfree names, the shared Nixpkgs serves every evaluation
        # instead of re-evaluating stdenv in a fresh instance; the choice reads
        # the configuration, so `path` and attribute names come from the shared
        # instance.
        specialArgs = {
          pkgs = let
            shared = inputs.nixpkgs.legacyPackages.${system};
            unfree = evaluation.config.nixpkgs.config.allowUnfreePackages;
            chosen =
              if unfree == []
              then shared
              else
                import inputs.nixpkgs {
                  inherit system;
                  config.allowUnfreePackages = unfree;
                };
          in
            builtins.mapAttrs (name: _: chosen.${name}) shared // {inherit (shared) path;};
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
            # standalone applies packages through current-profile.
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
          passthru.steps = lib.mapAttrs (_: step: step.package) cfg.applySteps;
        } ''
          mkdir -p "$out/bin"
          cat > "$out/bin/apply" <<'EOF'
          #!${pkgs.runtimeShell}
          set -e
          ${mylib.fragments.render (lib.mapAttrs (_: step: {
              text = lib.escapeShellArg "${step.package}/bin/apply";
              inherit (step) after before;
            })
            cfg.applySteps)}
          EOF
          chmod +x "$out/bin/apply"
        '';

      dependencies = sources ++ cfg.packages ++ [apply];

      preflight =
        pkgs.runCommand
        "hjem-preflight"
        {
          # Structured attrs keep store paths containing spaces, such as app
          # bundles, intact.
          __structuredAttrs = true;
          inherit dependencies;
        }
        ''
          for dependency in "''${dependencies[@]}"; do
            test -e "$dependency"
            printf '%s\n' "$dependency"
          done > "$out"
        '';

      # Hjem's per-user module imports nixpkgs' assertions module, which already
      # declares `assertions`.
      failedAssertions = mylib.assertions.failed cfg.assertions;
    in
      lib.mapAttrs (_: mylib.assertions.guard failedAssertions) {
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
