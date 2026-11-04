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
      caps = ["tap-hold-press" 70 70 "esc" "lctl"];
      # Swaps ; and : on a US layout.
      ";" = ["fork" "S-;" ["unmod" ["lsft" "rsft"] ";"] ["lsft" "rsft"]];
    };

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
      f-semicolon-slash = punctuation ";" "/";
    };
  };
}
