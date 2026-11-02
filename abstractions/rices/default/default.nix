{mylib, ...}:
mylib.rice {
  name = "default";
  myconfig = {
    shell.loginShell = "zsh";
    colorscheme.selection.name = "rose-pine";
  };
}
