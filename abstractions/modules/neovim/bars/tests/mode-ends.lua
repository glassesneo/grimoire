assert(vim.v.errmsg == "", vim.v.errmsg)
local output = vim.api.nvim_eval_statusline(vim.o.statusline, { maxwidth = 200 }).str
assert(output:find("LEFT%{1+1}", 1, true), "configured left mode indicator missing")
assert(output:find("RIGHT%{1+1}", 1, true), "configured right mode indicator missing")
vim.cmd("qa!")
