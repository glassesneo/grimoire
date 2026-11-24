{
  inputs,
  pkgs,
  system,
}: let
  inherit (pkgs) lib;

  makeSystem = (import ../../adapters/hjem {inherit inputs;}).moduleSystems.hjem.makeSystem;
  mkResult = modules:
    makeSystem {
      inherit modules;

      extraArgs = {
        inherit system;
        username = "fixture";
        homeDirectory = "/tmp/hjem-adapter-fixture";
      };
    };

  assertionModule = assertions: {inherit assertions;};

  result = mkResult [
    ./fixture.nix
    (assertionModule [
      {
        assertion = true;
        message = "passing assertion";
      }
    ])
  ];

  failing = mkResult [
    (assertionModule [
      {
        assertion = true;
        message = "passing assertion";
      }
      {
        assertion = false;
        message = "first failure";
      }
      {
        assertion = false;
        message = "second failure";
      }
    ])
  ];

  spacedSource = "${pkgs.writeTextDir "with space/file.txt" "fixture"}/with space/file.txt";
  spaced = mkResult [{files."spaced.txt".source = spacedSource;}];

  unfreePackage = {pkgs, ...}: {
    packages = [
      (pkgs.stdenvNoCC.mkDerivation {
        pname = "fixture-unfree";
        version = "1";
        meta.license = lib.licenses.unfree;
      })
    ];
  };
  allowUnfree = names: {nixpkgs.config.allowUnfreePackages = names;};

  step = name: status: {
    package = pkgs.writeShellScriptBin "apply" ''
      echo ${name} >> "$APPLY_LOG"
      exit ${toString status}
    '';
  };
  stepping = mkResult [
    {
      applySteps = {
        first = step "first" 0;
        second = step "second" 0;
      };
    }
  ];
  stopping = mkResult [
    {
      applySteps = {
        first = step "first" 0;
        failing = step "failing" 1 // {after = ["first"];};
        last = step "last" 0 // {after = ["failing"];};
      };
    }
  ];
  ordering = mkResult [
    {
      applySteps = {
        a = step "a" 0 // {after = ["c"];};
        b = step "b" 0;
        c = step "c" 0;
        d = step "d" 0 // {before = ["c"];};
      };
    }
  ];
  applyOf = steps: (mkResult [{applySteps = steps;}]).apply.drvPath;

  inherit (result) manifest;

  pick = suffix:
    lib.findFirst
    (file: lib.hasSuffix suffix file.target)
    (throw "Missing fixture file")
    manifest.files;

  package = builtins.head result.packages;

  script = name: env: text:
    pkgs.runCommand "hjem-adapter-${name}" env ''
      set -eu
      ${text}
      mkdir "$out"
    '';
in {
  cases = {
    failed-assertion-blocks-every-output = {
      protects = "the hjem adapter's assertion guard blocks the manifest, packages, preflight, and apply when any assertion fails, even after a passing one";
      expr = lib.genAttrs ["manifest" "packages" "preflight" "apply"] (output: (builtins.tryEval failing.${output}).success);
      expected = {
        manifest = false;
        packages = false;
        preflight = false;
        apply = false;
      };
    };
    step-ordered-against-unregistered-step-fails = {
      protects = "an apply step ordered against an unregistered step fails apply";
      expr = applyOf {a = step "a" 0 // {after = ["missing"];};};
      fails = true;
    };
    step-cycle-fails = {
      protects = "a cycle of apply step order declarations fails apply";
      expr = applyOf {
        a = step "a" 0 // {after = ["b"];};
        b = step "b" 0 // {after = ["a"];};
      };
      fails = true;
    };
    unlisted-unfree-package-fails = {
      protects = "an unfree package fails evaluation unless its name is listed in allowUnfreePackages";
      expr = (mkResult [unfreePackage]).packages;
      fails = true;
    };
    other-listed-name-keeps-unfree-package-failing = {
      protects = "listing another name in allowUnfreePackages does not allow an unfree package";
      expr = (mkResult [unfreePackage (allowUnfree ["other"])]).packages;
      fails = true;
    };
    manifest-validates = {
      protects = "the manifest the hjem adapter writes passes Hjem's manifest validation";
      build =
        script "manifest" {
          manifestFile = pkgs.writeText "hjem-test-manifest.json" (builtins.toJSON manifest);
          nativeBuildInputs = [inputs.hjem.packages.${system}.hjem];
        } ''
          hjem manifest validate --manifest "$manifestFile"
        '';
    };
    preflight-lists-file-sources-and-packages = {
      protects = "preflight lists the built source of text, generated string, and generated derivation files and every package";
      build =
        script "preflight" {
          inherit package;
          inherit (result) preflight;
          textPath = (pick "/from-text.txt").source;
          stringPath = (pick "/from-string.json").source;
          drvPath = (pick "/from-derivation.json").source;
        } ''
          for dependency in "$textPath" "$stringPath" "$drvPath" "$package"; do
            grep -Fxq "$dependency" "$preflight"
            test -e "$dependency"
          done
        '';
    };
    package-runs = {
      protects = "a package declared through the hjem adapter is published as a runnable package";
      build = script "package" {inherit package;} ''
        test "$("$package/bin/fixture-tool")" = "fixture"
      '';
    };
    preflight-keeps-spaced-source-whole = {
      protects = "preflight lists a source path containing spaces as one entry instead of splitting it";
      build =
        script "spaced" {
          inherit spacedSource;
          spacedPreflight = spaced.preflight;
        } ''
          grep -Fxq "$spacedSource" "$spacedPreflight"
        '';
    };
    preflight-lists-apply = {
      protects = "preflight lists the apply program that runs the registered steps";
      build =
        script "apply-preflight" {
          steppingApply = stepping.apply;
          steppingPreflight = stepping.preflight;
        } ''
          grep -Fxq "$steppingApply" "$steppingPreflight"
        '';
    };
    apply-runs-every-step = {
      protects = "apply runs every registered step";
      build = script "apply-steps" {steppingApply = stepping.apply;} ''
        export APPLY_LOG="$TMPDIR/stepping.log"
        "$steppingApply/bin/apply"
        test "$(sort "$APPLY_LOG")" = "$(printf 'first\nsecond')"
      '';
    };
    apply-stops-at-failing-step = {
      protects = "apply fails and runs no step after a step that fails";
      build = script "apply-stop" {stoppingApply = stopping.apply;} ''
        export APPLY_LOG="$TMPDIR/stopping.log"
        if "$stoppingApply/bin/apply"; then exit 1; fi
        test "$(cat "$APPLY_LOG")" = "$(printf 'first\nfailing')"
      '';
    };
    apply-follows-declared-order = {
      protects = "apply runs steps in the order their after and before declarations state, whatever the unrelated steps do";
      build = script "apply-order" {orderingApply = ordering.apply;} ''
        export APPLY_LOG="$TMPDIR/ordering.log"
        "$orderingApply/bin/apply"
        test "$(grep -vx b "$APPLY_LOG")" = "$(printf 'd\nc\na')"
      '';
    };
  };
}
