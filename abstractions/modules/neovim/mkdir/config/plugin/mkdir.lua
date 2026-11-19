vim.api.nvim_create_autocmd("BufWritePre", {
  group = vim.api.nvim_create_augroup("grimoire.mkdir", { clear = true }),
  callback = function (event)
    if vim.bo[event.buf].buftype ~= "" then
      return
    end
    local name = event.match
    if name == "" or name:match("^%a[%w+.-]*:") then
      return
    end
    vim.fn.mkdir(vim.fn.fnamemodify(name, ":h"), "p")
  end,
})
