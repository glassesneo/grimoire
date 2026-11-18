local M = { sources = {} }

function M.get()
  for _, accept in ipairs(M.sources) do
    if accept() then
      return true
    end
  end
  return vim.lsp.inline_completion.get()
end

return M
