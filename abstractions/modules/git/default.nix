{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "git";
  tests.fixture = ["exclusive" "zsh.interactive.zabrze"];
  meta.description = "Provide Git and configure the user's Git environment.";

  options.enable = delib.boolOption true;

  hjem.always = {pkgs, ...}: {
    options.git.settings = lib.mkOption {
      inherit (pkgs.formats.gitIni {}) type;
      default = {};
      description = "Settings written to the user's Git configuration file.";
    };
  };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: {
    packages = [
      pkgs.git
      pkgs.git-lfs
    ];

    git.settings = {
      user = {
        name = myconfig.identity.fullName;
        email = myconfig.identity.email;
        useConfigOnly = true;
        signingkey = myconfig.ssh.personalKeyFile;
      };
      commit = {
        verbose = true;
        template = "${config.xdg.config.directory}/git/gitmsg";
        gpgsign = true;
      };
      tag.gpgsign = true;
      gpg.format = "ssh";
      push.default = "nothing";
      init.defaultBranch = "main";
      core.excludesFile = "${config.xdg.config.directory}/git/ignore";
      url."git@github.com:".insteadOf = "https://github.com/";
      filter.lfs = {
        clean = "git-lfs clean -- %f";
        smudge = "git-lfs smudge -- %f";
        process = "git-lfs filter-process";
        required = true;
      };
    };

    xdg.config.files = {
      "git/config" = {
        exclusive = true;
        generator = lib.generators.toGitINI;
        value = config.git.settings;
      };
      "git/gitmsg" = {
        exclusive = true;
        source = ./gitmsg;
      };
      "git/ignore" = {
        exclusive = true;
        text = ''
          .agents
          .DS_Store
          .direnv
          .envrc
          var/
          *~
          *.swp
        '';
      };
    };

    # In diff abbreviations, c is --cached and s is --stat, in typed order.
    zsh.zabrze.snippets = {
      "git status" = {
        trigger = "gs";
        snippet = "git status --short --branch";
      };
      "git add" = {
        trigger = "ga";
        snippet = "git add";
      };
      "git add -A" = {
        trigger = "gaa";
        snippet = "git add -A";
      };
      "git commit" = {
        trigger = "gc";
        snippet = "git commit";
      };
      "git diff" = {
        trigger = "gd";
        snippet = "git diff";
      };
      "git diff --cached" = {
        trigger = "gdc";
        snippet = "git diff --cached";
      };
      "git diff --stat" = {
        trigger = "gds";
        snippet = "git diff --stat";
      };
      "git diff --cached --stat" = {
        trigger = "gdcs";
        snippet = "git diff --cached --stat";
      };
      "git diff --stat --cached" = {
        trigger = "gdsc";
        snippet = "git diff --stat --cached";
      };
      "git log" = {
        trigger = "gl";
        snippet = "git log --graph --decorate";
      };
      "git log graph" = {
        trigger = "glg";
        snippet = "git log --oneline --graph --decorate -n 20";
      };
      "git push --force-with-lease" = {
        trigger = "-f";
        snippet = "--force-with-lease";
        global = true;
        context = ''^git\s+push\s'';
      };
    };
  };
})
