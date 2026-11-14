# Zsh starts in the vi keymap when EDITOR names vi, as nvim does; bindings
# made later go into the emacs keymap this selects.
bindkey -e

# SKK takes Ctrl-J to kana and Ctrl-L to ASCII input, and passes the key
# through when already in that mode; the shell then does nothing with it.
ignore-key() {}
zle -N ignore-key
for keymap in emacs viins vicmd isearch command; do
  bindkey -M $keymap '^J' ignore-key '^L' ignore-key
done
unset keymap

HISTFILE="${XDG_STATE_HOME:-$HOME/.local/state}/zsh/history"
HISTSIZE=10000
SAVEHIST=10000
[[ -d ${HISTFILE:h} ]] || mkdir -p ${HISTFILE:h}

setopt EXTENDED_HISTORY HIST_FCNTL_LOCK
setopt SHARE_HISTORY
setopt HIST_IGNORE_ALL_DUPS HIST_EXPIRE_DUPS_FIRST

setopt NO_CLOBBER APPEND_CREATE

# Exiting the shell takes an explicit exit rather than an EOF.
setopt IGNORE_EOF
