require("tiny-inline-diagnostic").setup({
  options = {
    multilines = {
      enabled = true,
      always_show = true,
    },
  },
})

vim.diagnostic.config({
  virtual_text = false,
  signs = false,
  underline = true,
})
