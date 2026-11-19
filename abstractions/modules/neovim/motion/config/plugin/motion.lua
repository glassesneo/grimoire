require("mini.jump").setup({
  delay = { highlight = 10000000, idle_stop = 2000 },
})
require("eyeliner").setup({
  highlight_on_key = false,
  default_keymaps = false,
  dim = false,
})
require("numb").setup()

vim.keymap.set("n", "*", function ()
  local word = vim.fn.expand("<cword>")
  if word == "" then
    return
  end
  local pattern = [[\<\V]] .. vim.fn.escape(word, [[\]]) .. [[\m\>]]
  vim.fn.setreg("/", pattern)
  vim.fn.histadd("search", pattern)
  vim.v.searchforward = 1
  vim.v.hlsearch = 1
end, { desc = "Search word without moving" }
)
