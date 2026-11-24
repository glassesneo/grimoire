vim.opt.clipboard = ""
local function keys(input)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(input, true, false, true), "xt", false)
end
local function start(text)
  vim.cmd("enew!")
  vim.bo.autoindent = false
  vim.bo.undolevels = -1
  vim.api.nvim_buf_set_lines(0, 0, -1, false, { text or "" })
  vim.bo.undolevels = 1000
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
end
local function line(expected)
  assert(
    vim.api.nvim_get_current_line() == expected,
    "expected " .. vim.inspect(expected) .. ", got " .. vim.inspect(vim.api.nvim_get_current_line())
  )
end

for _, pair in ipairs(require("grimoire.autopairs_pairs")) do
  start()
  keys("i" .. pair.open .. "text" .. pair.close .. "<Esc>")
  line(pair.open .. "text" .. pair.close)
  start()
  keys("i" .. pair.open .. "<BS><Esc>")
  line("")
end

start("()")
keys("li)<Esc>")
line("())")
start("()")
keys("li<BS><Esc>")
line("")
start()
keys("i([word])<Esc>")
line("([word])")

start("first")
vim.api.nvim_buf_set_lines(0, 1, -1, false, { "second" })
keys("A(<Esc>j.li)<Esc>")
line("second())")

start()
keys("i(<Esc>0i文章<Esc>$i)<Esc>")
line("文章()")

start()
keys("i(<Esc>")
vim.api.nvim_buf_set_text(0, 0, 1, 0, 2, { ")" })
keys("0li)<Esc>")
line("())")

start()
keys("i(<Esc>")
vim.cmd("undo")
line("")
vim.cmd("redo")
line("()")
keys("0li)<Esc>")
line("()")

start()
keys("i(<Esc>")
local generated = vim.api.nvim_get_current_buf()
start("()")
keys("li)<Esc>")
line("())")
vim.api.nvim_set_current_buf(generated)
keys("0li)<Esc>")
line("()")

start()
vim.api.nvim_buf_set_name(0, vim.fn.tempname())
keys("i(<Esc>")
vim.cmd.write()
vim.cmd("edit!")
keys("0li)<Esc>")
line("())")

require("grimoire.autopairs").setup({ { open = "<", close = ">" } })
start()
keys("i(<word><Esc>")
line("(<word>")
start()
keys("i<<BS><Esc>")
line("")

start()
vim.bo.buftype = "nofile"
keys("i<<Esc>")
line("<")
vim.cmd("qa!")
