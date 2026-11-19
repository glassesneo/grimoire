vim.o.cmdheight = 0
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
