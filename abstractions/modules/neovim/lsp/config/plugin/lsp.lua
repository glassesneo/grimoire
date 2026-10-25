-- Servers missing from PATH are skipped by vim.lsp.enable, so project shells
-- decide which of these actually start.
vim.lsp.enable({ "emmylua_ls", "nil_ls" })

vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("grimoire.lsp.format", {}),
  callback = function (args)
    local client = assert(vim.lsp.get_client_by_id(args.data.client_id))
    if not client:supports_method("textDocument/formatting", args.buf) then
      return
    end
    vim.api.nvim_create_autocmd("BufWritePre", {
      group = vim.api.nvim_create_augroup("grimoire.lsp.format." .. args.buf, {}),
      buffer = args.buf,
      callback = function ()
        vim.lsp.buf.format({ bufnr = args.buf, timeout_ms = 500 })
      end,
    })
  end,
})
