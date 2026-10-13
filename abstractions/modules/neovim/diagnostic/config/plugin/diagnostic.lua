require("tiny-inline-diagnostic").setup({
  options = {
    multilines = {
      enabled = true,
      always_show = true,
    },
  },
})

-- tiny-inline-diagnostic draws the messages, so the built-in text and signs
-- would only duplicate them.
vim.diagnostic.config({
  virtual_text = false,
  signs = false,
  underline = true,
})
