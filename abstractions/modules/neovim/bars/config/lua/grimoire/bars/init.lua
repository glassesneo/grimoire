local M = {}

function M.setup(opts)
  local heirline = require("heirline")
  local layout = require("grimoire.bars.layout")
  heirline.setup({
    statusline = layout.statusline(opts.modeEnds),
    tabline = layout.tabline(),
  })
  vim.o.laststatus = 3
  vim.o.showtabline = 2
  vim.o.showmode = false

  local function redraw()
    vim.cmd.redrawstatus()
    vim.cmd.redrawtabline()
  end
  local group = vim.api.nvim_create_augroup("grimoire.bars", { clear = true })
  vim.api.nvim_create_autocmd({
    "ModeChanged",
    "DiagnosticChanged",
    "LspAttach",
    "LspDetach",
    "BufEnter",
    "BufFilePost",
    "BufWritePost",
  },
    {
      group = group,
      callback = vim.schedule_wrap(redraw),
    })
  vim.api.nvim_create_autocmd("OptionSet", {
    group = group,
    pattern = { "modified", "readonly", "modifiable" },
    callback = vim.schedule_wrap(redraw),
  })
  vim.api.nvim_create_autocmd("User", {
    group = group,
    pattern = "GitSignsUpdate",
    callback = vim.schedule_wrap(redraw),
  })
  vim.api.nvim_create_autocmd("ColorScheme", {
    group = group,
    callback = function ()
      heirline.reset_highlights()
      redraw()
    end,
  })
end

return M
