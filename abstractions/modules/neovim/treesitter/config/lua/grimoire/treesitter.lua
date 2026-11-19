local M = {}
local indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"

function M.setup(registrations)
  local filetypes = {}
  local managed = {}
  for _, entry in pairs(registrations) do
    for filetype, parser in pairs(entry.filetypes) do
      vim.treesitter.language.register(parser, filetype)
      filetypes[filetype] = { parser = parser, highlight = entry.highlight, indent = entry.indent }
    end
  end

  local function apply(buf)
    local previous = managed[buf]
    if previous then
      if previous.highlight then
        vim.treesitter.stop(buf)
      end
      if previous.indentexpr and vim.bo[buf].indentexpr == indentexpr then
        vim.bo[buf].indentexpr = previous.indentexpr
      end
      managed[buf] = nil
    end

    local entry = filetypes[vim.bo[buf].filetype]
    if not entry or vim.bo[buf].buftype ~= "" then
      return
    end

    local state = {}
    if entry.highlight then
      vim.treesitter.start(buf, entry.parser)
      state.highlight = true
    end
    if entry.indent and vim.treesitter.query.get(entry.parser, "indents") then
      state.indentexpr = vim.bo[buf].indentexpr
      vim.bo[buf].indentexpr = indentexpr
    end
    managed[buf] = state
  end

  local group = vim.api.nvim_create_augroup("grimoire.treesitter", { clear = true })
  vim.api.nvim_create_autocmd("FileType", {
    group = group,
    callback = function (event)
      apply(event.buf)
    end,
  })
  vim.api.nvim_create_autocmd("BufWipeout", {
    group = group,
    callback = function (event)
      managed[event.buf] = nil
    end,
  })
end

return M
