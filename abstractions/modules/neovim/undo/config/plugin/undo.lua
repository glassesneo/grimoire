vim.keymap.set("n", "<Space>u", function ()
  vim.fn.mkdir(vim.fn.stdpath("cache"), "p")
  Snacks.picker.undo()
end, { desc = "Undo history" }
)
