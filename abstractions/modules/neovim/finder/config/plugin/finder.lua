local layout = { cycle = true, col = 0.45, height = 0.5, row = -2, width = 0.98, position = "float" }

require("snacks").setup({
  explorer = {
    enabled = true,
    replace_netrw = true,
  },
  picker = {
    enabled = true,
    sources = {
      smart = { hidden = true, ignored = false, layout = { layout = layout } },
      files = { hidden = true, ignored = false, layout = { layout = layout } },
      grep = { hidden = true, ignored = false, layout = { layout = layout } },
      explorer = {
        hidden = true,
        ignored = false,
        git_untracked = true,
        layout = { layout = { box = "vertical", position = "left" } },
      },
    },
  },
})

vim.keymap.set("n", "<Space><Space>", function ()
  Snacks.picker.smart()
end, { desc = "Find files" }
)

vim.keymap.set("n", "<Space>g", function ()
  Snacks.picker.grep()
end, { desc = "Grep files" }
)

vim.keymap.set("n", "<Space>f", function ()
  Snacks.picker.explorer()
end, { desc = "File explorer" }
)
