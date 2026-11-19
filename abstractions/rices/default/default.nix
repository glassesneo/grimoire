{mylib, ...}:
mylib.rice {
  name = "default";
  myconfig = {
    roles.login-shell.enable = true;
    colorscheme.selection.name = "rose-pine";
    neovim.bars.modeEnds = {
      left = "█";
      right = "█";
    };
  };
}
