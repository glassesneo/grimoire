local map = vim.keymap.set

map("n", "q", "<Nop>")
map("n", "r", "<C-r>")
map("n", "<C-r>", "r")
map({ "n", "x", "o" }, "<Space>h", "^")
map({ "n", "x", "o" }, "<Space>l", "$")
map({ "n", "x", "o" }, "M", "%")

map("i", "<C-a>", "<C-o>^")
map("i", "<C-e>", function ()
  if require("grimoire.inline_completion").get() then
    return ""
  end
  return "<C-o>$"
end, { expr = true }
)
map("i", "<C-b>", "<Left>")
map("i", "<C-f>", "<Right>")
map({ "i", "c" }, "<C-j>", "<Nop>")
map({ "i", "c" }, "<C-l>", "<Nop>")

map({ "n", "x" }, "x", '"_d')
map("o", "x", "d")
map({ "n", "x" }, "X", '"_D')

for _, quote in ipairs({ '"', "'", "`" }) do
  map({ "x", "o" }, "a" .. quote, "2i" .. quote)
end

map("x", "y", "mzy`z")
map("x", "gc", "mz:normal gcc<CR>`z", { silent = true })
