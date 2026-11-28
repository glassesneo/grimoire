local cache = vim.fn.stdpath("cache")
local picker = Snacks.picker
vim.fn.delete(cache, "rf")
picker.undo = function ()
  assert(vim.fn.isdirectory(cache) == 1, "undo requires a prepared cache directory")
end
vim.fn.maparg("<Space>u", "n", false, true).callback()
vim.cmd("qa!")
