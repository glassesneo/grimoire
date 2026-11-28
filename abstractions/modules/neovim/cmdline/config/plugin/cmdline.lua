vim.o.cmdheight = 0

vim.api.nvim_create_autocmd("CmdlineEnter", {
  group = vim.api.nvim_create_augroup("grimoire.cmdline.load", { clear = true }),
  once = true,
  callback = function ()
    require("noice").setup({
      cmdline = {
        enabled = true,
        view = "cmdline_popup",
      },
      views = {
        cmdline_popup = {
          backend = "grimoire_cmdline",
          position = { row = 3, col = "50%" },
        },
      },
      popupmenu = { enabled = false },
      messages = { enabled = false },
      notify = { enabled = false },
      lsp = {
        progress = { enabled = false },
        hover = { enabled = false },
        signature = { enabled = false },
        message = { enabled = false },
        override = {
          ["vim.lsp.util.convert_input_to_markdown_lines"] = false,
          ["vim.lsp.util.stylize_markdown"] = false,
          ["cmp.entry.get_documentation"] = false,
        },
      },
    })
  end,
})
