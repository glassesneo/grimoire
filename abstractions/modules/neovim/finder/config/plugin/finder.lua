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
