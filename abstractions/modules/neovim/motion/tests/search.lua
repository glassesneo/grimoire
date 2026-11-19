-- Our * callback changes search state without jumping. Matching itself is
-- trusted; a punctuation-bearing keyword catches accidental regex expansion.
-- Builds cannot detect this Lua callback moving the user or searching for a
-- different word; cursor and search state are the stable observable boundary.
vim.cmd("enew!")
vim.opt.iskeyword:append(".")
vim.api.nvim_buf_set_lines(0, 0, -1, false, { "foo.bar fooxbar foo.bar" })
vim.api.nvim_win_set_cursor(0, { 1, 0 })
vim.v.searchforward = 0
local function keys(input)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(input, true, false, true), "xt", false)
end
keys("*")
assert(vim.deep_equal(vim.api.nvim_win_get_cursor(0), { 1, 0 }), "* must not jump")
assert(vim.v.searchforward == 1 and vim.v.hlsearch == 1)
assert(vim.fn.histget("search", -1) == vim.fn.getreg("/"))
keys("n")
assert(vim.deep_equal(vim.api.nvim_win_get_cursor(0), { 1, 16 }), "keyword search must be literal")

local pattern = vim.fn.getreg("/")
vim.api.nvim_buf_set_lines(0, 0, -1, false, { "   " })
vim.api.nvim_win_set_cursor(0, { 1, 1 })
keys("*")
assert(vim.fn.getreg("/") == pattern)
assert(vim.deep_equal(vim.api.nvim_win_get_cursor(0), { 1, 1 }))
vim.cmd("qa!")
