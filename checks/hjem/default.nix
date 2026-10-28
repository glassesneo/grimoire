{
  inputs,
  pkgs,
  system,
}: let
  lib = pkgs.lib;

  # Test the adapter's output and assertion guard at its Hjem input boundary.
  # Denix assertion forwarding is covered separately against the real composition.
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

  # A passing assertion must not be reported, and later failures must not be
  # skipped: an implementation that only inspects the first assertion would let
  # this configuration through.
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

  # The guard wraps the whole result, so forcing any output must evaluate it.
  # `tryEval` reports only whether evaluation was blocked, not the message text.
  blockedOutputs =
    !(builtins.tryEval failing.manifest).success
    && !(builtins.tryEval failing.packages).success
    && !(builtins.tryEval failing.preflight).success
    && !(builtins.tryEval failing.apply).success;

  # Preflight must not split a source path at its spaces.
  spacedSource = "${pkgs.writeTextDir "with space/file.txt" "fixture"}/with space/file.txt";
  spaced = mkResult [{files."spaced.txt".source = spacedSource;}];

  # An unfree package evaluates only when its name is listed, and listing it
  # from two modules merges rather than conflicts.
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
  unfreeEvaluates = modules: (builtins.tryEval (builtins.deepSeq (mkResult modules).packages true)).success;

  # Each registered step logs its name; the failing one exits after logging, so
  # no line may follow it whatever order the steps run in.
  step = name: status:
    pkgs.writeShellScriptBin "apply" ''
      echo ${name} >> "$APPLY_LOG"
      exit ${toString status}
    '';
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
        failing = step "failing" 1;
        last = step "last" 0;
      };
    }
  ];

  manifest = result.manifest;

  pick = suffix:
    lib.findFirst
    (file: lib.hasSuffix suffix file.target)
    (throw "Missing fixture file")
    manifest.files;

  textFile = pick "/from-text.txt";
  stringFile = pick "/from-string.json";
  drvFile = pick "/from-derivation.json";
  package = builtins.head result.packages;

  manifestFile =
    pkgs.writeText "hjem-test-manifest.json"
    (builtins.toJSON manifest);
in {
  check = assert lib.assertMsg (
    manifest.version
    == 3
    && builtins.length manifest.files == 3
    && lib.all (file: file.type == "symlink" && !file.clobber) manifest.files
    && lib.all (file: !lib.hasSuffix "/disabled.txt" file.target) manifest.files
    && builtins.length result.packages == 1
  ) "Hjem adapter contract failed";
  assert lib.assertMsg blockedOutputs "Failed assertions must block manifest, packages, preflight, and apply";
  assert lib.assertMsg (builtins.attrNames stepping.apply.steps == ["first" "second"]) "Registered steps must be exposed by name";
  assert lib.assertMsg (!unfreeEvaluates [unfreePackage]) "An unlisted unfree package must fail evaluation";
  assert lib.assertMsg (!unfreeEvaluates [unfreePackage (allowUnfree ["other"])]) "Listing another name must not allow an unfree package";
  assert lib.assertMsg (unfreeEvaluates [unfreePackage (allowUnfree ["fixture-unfree"]) (allowUnfree ["other"])]) "A listed unfree package must evaluate when definitions merge";
    pkgs.runCommand "hjem-adapter-test" {
      inherit manifestFile package;
      inherit (result) preflight;
      inherit spacedSource;
      spacedPreflight = spaced.preflight;
      steppingApply = stepping.apply;
      steppingPreflight = stepping.preflight;
      stoppingApply = stopping.apply;

      textPath = textFile.source;
      stringPath = stringFile.source;
      drvPath = drvFile.source;

      nativeBuildInputs = [inputs.hjem.packages.${system}.hjem];
    } ''
      set -eu

      hjem manifest validate --manifest "$manifestFile"

      for dependency in "$textPath" "$stringPath" "$drvPath" "$package"; do
        grep -Fxq "$dependency" "$preflight"
        test -e "$dependency"
      done

      test "$("$package/bin/fixture-tool")" = "fixture"
      grep -Fxq "$spacedSource" "$spacedPreflight"

      grep -Fxq "$steppingApply" "$steppingPreflight"
      export APPLY_LOG="$TMPDIR/stepping.log"
      "$steppingApply/bin/apply"
      test "$(sort "$APPLY_LOG")" = "$(printf 'first\nsecond')"

      export APPLY_LOG="$TMPDIR/stopping.log"
      if "$stoppingApply/bin/apply"; then exit 1; fi
      test "$(tail -n 1 "$APPLY_LOG")" = failing

      mkdir "$out"
      touch "$out/passed"
    '';
}
