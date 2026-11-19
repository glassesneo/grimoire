{
  delib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) rose-pine;

  # The ports are scripts exporting FZF_DEFAULT_OPTS; an entry is an options
  # file holding the quoted value.
  themes = mylib.schemeThemes {
    name = "fzf";
    themes.rose-pine = pkgs:
      pkgs.runCommandLocal "fzf-rose-pine" {
        src = rose-pine;
      } ''
        sed -e '1s/^export FZF_DEFAULT_OPTS="//' -e '$s/"$//' "$src/dist/rose-pine.sh" > "$out"
      '';
  };
in
  delib.module ({myconfig, ...}: let
    inherit (myconfig.roles.colorscheme) resolved;
  in {
    name = "fzf.colorscheme";
    tests.fixture = ["fzf" "roles.colorscheme"];
    meta = {
      description = "Give fzf the colors of the held color scheme.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    constraints.ifEnabled = [(themes.constraint resolved)];

    # fzf reads the file before FZF_DEFAULT_OPTS.
    hjem.ifEnabled = {pkgs, ...}: {
      environment.sessionVariables.FZF_DEFAULT_OPTS_FILE = themes.of resolved pkgs;
    };
  })
