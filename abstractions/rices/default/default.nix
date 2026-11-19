{mylib, ...}:
mylib.rice {
  name = "default";
  myconfig = {
    roles.login-shell.enable = true;
    roles.colorscheme = {
      enable = true;
      holder = "colorscheme.rose-pine";
    };
    neovim.bars.modeEnds = {
      left = "█";
      right = "█";
    };
  };
}
