bindkey -e

# SKK passes Ctrl-J and Ctrl-L through when already in that mode; the shell
# ignores them.
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

setopt IGNORE_EOF
