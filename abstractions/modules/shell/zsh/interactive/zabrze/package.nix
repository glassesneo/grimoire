# Owns the zabrze build, which nixpkgs does not provide.
{
  fetchFromGitHub,
  lib,
  rustPlatform,
}:
rustPlatform.buildRustPackage (finalAttrs: {
  pname = "zabrze";
  version = "0.7.3";

  src = fetchFromGitHub {
    owner = "Ryooooooga";
    repo = "zabrze";
    tag = "v${finalAttrs.version}";
    hash = "sha256-OmwU7/SQqEAzZo7/Eix3yc+VLEU6+/NIiALvpU3PlKA=";
  };

  cargoHash = "sha256-9UZSOXTWvX9jPE0crGb/hUpemuVhEGgyzs+HL3QwIgg=";

  # These tests pass EDITOR to `zsh -c`, which the build machine's /etc/zshenv
  # can override on Darwin.
  checkFlags = [
    "--skip=test_evaluate"
    "--skip=test_legacy_yaml"
  ];

  meta = {
    description = "Zsh abbreviation expansion plugin";
    homepage = "https://github.com/Ryooooooga/zabrze";
    license = lib.licenses.mit;
    mainProgram = "zabrze";
  };
})
