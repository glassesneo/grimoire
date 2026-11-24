local root = vim.fn.tempname()
vim.fn.mkdir(root, "p")
vim.cmd.cd(root)
vim.cmd("enew!")
vim.api.nvim_buf_set_name(0, root .. "/nested path/deep/file.txt")
vim.api.nvim_buf_set_lines(0, 0, -1, false, { "saved" })
vim.cmd.write()
assert(vim.deep_equal(vim.fn.readfile(root .. "/nested path/deep/file.txt"), { "saved" }))

vim.cmd.write(root .. "/other/deep/copy.txt")
assert(vim.deep_equal(vim.fn.readfile(root .. "/other/deep/copy.txt"), { "saved" }))

vim.cmd("enew!")
vim.api.nvim_buf_set_name(0, root .. "/special/deep/file")
vim.bo.buftype = "nofile"
vim.api.nvim_exec_autocmds("BufWritePre", { buffer = 0 })
assert(vim.fn.isdirectory(root .. "/special") == 0)

vim.cmd("enew!")
vim.api.nvim_buf_set_name(0, "synthetic://remote/nested/file")
vim.api.nvim_exec_autocmds("BufWritePre", { buffer = 0 })
assert(vim.fn.isdirectory(root .. "/synthetic:") == 0)
vim.cmd("qa!")
