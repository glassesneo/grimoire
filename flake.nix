{
  description = "grimoire: my computing environment, built with Denix";
  outputs = inputs @ {
    self,
    nixpkgs,
    denix,
    treefmt-nix,
    ...
  }: let
    inherit (nixpkgs) lib;
    mylib = import ./lib {
      inherit lib;
      anchorRoot = ./abstractions/modules;
    };
    systems = ["aarch64-darwin" "aarch64-linux" "x86_64-linux"];
    forAllSystems = lib.genAttrs systems;

    compose = abstractions:
      denix.lib.denixConfiguration {
        extraInputs = inputs;
        specialArgs = {
          inherit mylib;
          delib.role = mylib.roles.declare denix.lib;
        };

        modules =
          [
            denix.denixModules.nixDarwin
            ./adapters/hjem
            ./adapters/bundles.nix
            ./extensions/hosts.nix
            ./extensions/module-constraints.nix
            ./extensions/module-dependencies.nix
            ./extensions/module-metadata.nix
            ./extensions/module-tests.nix
            ./extensions/provenance.nix
            ./extensions/rices.nix
            ./extensions/roles.nix
          ]
          ++ abstractions;
      };

    configuration = compose (lib.fileset.toList (
      lib.fileset.fileFilter
      (file: file.name == "default.nix")
      ./abstractions
    ));

    hosts = configuration.config.hosts;

    # Defaults read a placeholder host whose values are the `myconfig.host`
    # expressions they stand for; its system stays real because nix-darwin and
    # packages are evaluated for it.
    authoring = import ./lib/authoring.nix {inherit lib;} (let
      docsSystem = "aarch64-darwin";
      host = "\${myconfig.host.name}";
      userName = "\${myconfig.host.user.name}";
      homeDirectory = "\${myconfig.host.user.homeDirectory}";
      placeholder = configuration.extendModules {
        modules = [
          ({delib, ...}:
            delib.host {
              name = host;
              system = docsSystem;
              user = {
                name = userName;
                inherit homeDirectory;
              };
            })
        ];
      };
    in {
      inherit host;
      library = mylib.library {
        entries = {
          inherit mylib;
          delib.role = mylib.roles.declare denix.lib;
        };
        internal = map (path: "mylib.${path}") mylib.internal;
      };
      # Anchors are named by module directory, as pin names repeat across
      # modules.
      sources =
        lib.mapAttrs (_: input: input.outPath) (removeAttrs inputs ["self"])
        // lib.concatMapAttrs (directory: file:
          lib.mapAttrs' (pin: source: lib.nameValuePair "${directory}/${pin}" source.outPath) (mylib.anchors.sources file))
        (mylib.anchors.discover ./abstractions/modules);
      configuration = placeholder;
      root = self;
      pkgs = nixpkgs.legacyPackages.${docsSystem};
      moduleSystems = {
        hjem =
          (configuration.genSystem {
            moduleSystem = "hjem";
            extraArgs = {
              inherit homeDirectory;
              system = docsSystem;
              username = userName;
            };
          }).options;
        darwin =
          (placeholder.genSystem {
            moduleSystem = "darwin";
            inherit host;
          }).options;
        bundles =
          (configuration.genSystem {
            moduleSystem = "bundles";
            extraArgs.system = docsSystem;
          }).options;
      };
    });

    darwinConfigurations =
      builtins.mapAttrs
      (hostName: _:
        configuration.genSystem {
          moduleSystem = "darwin";
          host = hostName;
        })
      (lib.filterAttrs
        (_: host: (lib.systems.elaborate host.system).isDarwin)
        hosts);

    hjemConfigurations =
      lib.mapAttrs'
      (hostName: host:
        lib.nameValuePair "${host.user.name}@${hostName}" (builtins.removeAttrs (configuration.genSystem {
          moduleSystem = "hjem";
          host = hostName;

          extraArgs = {
            inherit (host) system;
            inherit (host.user) homeDirectory;
            username = host.user.name;
          };
        }) ["options"]))
      hosts;

    perSystem = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
      treefmt = treefmt-nix.lib.evalModule pkgs {
        projectRootFile = "flake.nix";
        settings.global.excludes = ["**/bun.nix"];
        programs = {
          alejandra.enable = true;
          deadnix.enable = true;
          statix = {
            enable = true;
            disabled-lints = ["repeated_keys"];
          };
          # Bun rewrites package.json.
          oxfmt = {
            enable = true;
            includes = ["*.ts" "*.tsx" "*.js" "*.jsx" "*.mjs" "*.cjs"];
          };
          just = {
            enable = true;
            indentation = "  ";
          };
        };
        # Lint fixes run before alejandra, which formats their rewrites.
        settings.formatter.statix.priority = 1;
        settings.formatter.deadnix.priority = 2;
        settings.formatter.alejandra.priority = 3;
        settings.formatter.crystal = {
          command = "${pkgs.crystal}/bin/crystal";
          options = ["tool" "format"];
          includes = ["*.cr"];
        };
        settings.formatter.luafmt = {
          command = "${pkgs.emmylua-formatter}/bin/luafmt";
          options = ["--write"];
          includes = ["*.lua"];
        };
      };
      publishedBundles =
        (configuration.genSystem {
          moduleSystem = "bundles";
          extraArgs = {inherit system;};
        }).packages;
      existingPackages = {
        hjem = inputs.hjem.packages.${system}.hjem;
      };
      packageCollisions = builtins.attrNames (builtins.intersectAttrs existingPackages publishedBundles);

      checkOutputs = import ./checks {
        inherit inputs denix pkgs system configuration compose authoring;
        formatting = treefmt.config.build.check self;
        outputs = {
          packages = self.packages.${system};
          devShells = self.devShells.${system};
          formatter = self.formatter.${system};
        };
        hosts =
          lib.mapAttrs (hostName: host: {
            hjem = hjemConfigurations."${host.user.name}@${hostName}";
            darwin = darwinConfigurations.${hostName} or null;
          })
          (lib.filterAttrs (_: host: host.system == system) hosts);
      };
      commitHooks = import ./git-hooks.nix {
        inherit pkgs system;
        inherit (inputs) git-hooks;
        src = self;
      };
    in {
      packages =
        if packageCollisions != []
        then throw "Published bundles collide with existing packages: ${lib.concatStringsSep ", " packageCollisions}"
        else existingPackages // publishedBundles;

      devShells.default = pkgs.mkShellNoCC {
        packages = [
          pkgs.just
          pkgs.nix-fast-build
          pkgs.npins
          pkgs.nushell
          pkgs.bun
          pkgs.oxfmt
          pkgs.oxlint
          pkgs.tsgolint
          inputs.bun2nix.packages.${system}.default
          pkgs.emmylua-ls
          pkgs.emmylua-check
          self.packages.${system}.hjem
        ];
        inherit (commitHooks) shellHook;
      };

      formatter = treefmt.config.build.wrapper;
      inherit checkOutputs;
      inherit (checkOutputs) checks;
    });
  in {
    packages = lib.mapAttrs (_: outputs: outputs.packages) perSystem;
    devShells = lib.mapAttrs (_: outputs: outputs.devShells) perSystem;
    formatter = lib.mapAttrs (_: outputs: outputs.formatter) perSystem;
    checks = lib.mapAttrs (_: outputs: outputs.checks) perSystem;
    lib.checks = lib.mapAttrs (_: outputs: outputs.checkOutputs.metadata) perSystem;
    lib.authoring = {
      inherit (authoring) modules reference;
    };
    lib.moduleOptions = authoring.moduleOptions;
    lib.compose = compose;

    inherit darwinConfigurations hjemConfigurations;
  };

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    denix = {
      url = "github:yunfachi/denix/rewrite";
      inputs = {
        nixpkgs.follows = "nixpkgs";
      };
    };
    nix-darwin = {
      url = "github:nix-darwin/nix-darwin/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    imprynt = {
      url = "github:glassesneo/imprynt";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    hjem = {
      url = "github:feel-co/hjem";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-secrets = {
      url = "github:unnamed-systems/nix-secrets/857a7594bc4cd65533bc9fcdd056dc843e10e441";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    llm-agents.url = "github:numtide/llm-agents.nix";
    # nix-community/bun2nix rejects the lockfile version 2 written by Bun 1.4
    # (nix-community/bun2nix#110); llm-agents carries a fork that accepts it.
    bun2nix.follows = "llm-agents/bun2nix";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}
