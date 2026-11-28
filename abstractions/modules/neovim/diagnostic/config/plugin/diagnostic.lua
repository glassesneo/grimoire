vim.diagnostic.config({
  virtual_text = false,
  signs = false,
  underline = true,
})

vim.api.nvim_create_autocmd({ "LspAttach", "DiagnosticChanged" }, {
  group = vim.api.nvim_create_augroup("grimoire.diagnostic.load", { clear = true }),
  once = true,
  callback = function ()
    require("tiny-inline-diagnostic").setup({
      options = {
        multilines = {
          enabled = true,
          always_show = true,
        },
      },
    })
  end,
})
