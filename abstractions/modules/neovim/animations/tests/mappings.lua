assert(vim.v.errmsg == "", vim.v.errmsg)
vim.api.nvim_buf_set_lines(0, 0, -1, false, { "needle one", "needle two" })
local redo_calls, animated_redo, star_calls = 0, 0, 0
vim.keymap.set("n", "r", function ()
  redo_calls = redo_calls + 1
end)
vim.keymap.set("n", "*", function ()
  star_calls = star_calls + 1
end)

vim.api.nvim_exec_autocmds("VimEnter", {})
require("tiny-glimmer").redo = function ()
  animated_redo = animated_redo + 1
end

vim.cmd.normal("r")
assert(redo_calls == 1, "redo no longer invokes the existing mapping")
assert(animated_redo == 1, "redo mapping was not decorated after startup")
vim.cmd.normal("*")
assert(star_calls == 1, "scroll setup replaced the existing star mapping")
vim.cmd("qa!")
