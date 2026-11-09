# Keymaps that a host selects with `kanata.profile`, by name. Each is a set
# of `kanata` option values.
{
  default = {
    settings = {
      process-unmapped-keys = true;
      log-layer-changes = false;
      chords-v2-min-idle = 5;
    };

    layers.base = {
      # Taps Escape, holds Control.
      caps = ["tap-hold-press" 70 70 "esc" ["multi" "lctl" ["layer-while-held" "caps-held"]]];
      # Taps Backspace, holds Command.
      lmet = ["tap-hold-press" 250 100 "bspc" "lmet"];
      # Taps Tab, holds Command.
      rmet = ["tap-hold-press" 200 200 "tab" "rmet"];
      # Swaps ; and : on a US layout.
      ";" = ["fork" "S-;" ["unmod" ["lsft" "rsft"] ";"] ["lsft" "rsft"]];
    };

    # Without unmod, the held Control would turn this into Control-Escape.
    layers.caps-held.";" = ["unmod" "esc"];

    # F with K, L and ; types , . and /.
    chords = let
      punctuation = key: action: {
        keys = ["f" key];
        inherit action;
        timeout = 40;
        release = "first-release";
      };
    in {
      f-k-comma = punctuation "k" ",";
      f-l-period = punctuation "l" ".";
      # Off while Caps is held, so the chord cannot delay or capture its ;.
      f-semicolon-slash = punctuation ";" "/" // {disabledLayers = ["caps-held"];};
    };
  };
}
