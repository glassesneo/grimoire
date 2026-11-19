local before = {
  statusline = vim.o.statusline,
  tabline = vim.o.tabline,
  winbar = vim.o.winbar,
  laststatus = vim.o.laststatus,
  showtabline = vim.o.showtabline,
}
local components = require("grimoire.bars.components")
for option, value in pairs(before) do
  assert(vim.o[option] == value, "loading components must not install a layout: " .. option)
end

local root = vim.fn.tempname() .. "/project%name"
vim.fn.mkdir(root .. "/.git", "p")
local function file(name)
  local path = root .. "/" .. name
  vim.fn.writefile({ "fixture" }, path)
  return vim.fn.bufadd(path)
end

local focused = file("focused.fixture")
local target = file("target%{1+1}.fixture")
vim.fn.bufload(target)
vim.api.nvim_set_current_buf(focused)
vim.bo[target].filetype = "targettype"
vim.bo[focused].filetype = "focusedtype"
vim.bo[target].readonly = true
vim.b[target].gitsigns_head = "branch%{1+1}"
vim.b[target].gitsigns_status_dict = { added = 7, changed = 3, removed = 2 }
local ns = vim.api.nvim_create_namespace("bars-fixture")
vim.diagnostic.set(ns, target, {
  { lnum = 0, col = 0, message = "fixture", severity = vim.diagnostic.severity.ERROR },
})

local function fields(buf)
  return {
    static = { bufnr = buf },
    components.filename(),
    { provider = "|" },
    components.path(),
    { provider = "|" },
    components.project(),
    { provider = "|" },
    components.branch(),
    { provider = "|" },
    components.filetype(),
    { provider = "|" },
    components.flags(),
    { provider = "|" },
    components.git_diff(),
    { provider = "|" },
    components.diagnostics(),
    { provider = "|" },
    components.lsp(),
  }
end

require("heirline").setup({
  statusline = fields(target),
  tabline = fields(focused),
})
local function render(option, tabline)
  return vim.api.nvim_eval_statusline(vim.o[option], { maxwidth = 2000, use_tabline = tabline or false }).str
end

local output = render("statusline")
for _, value in ipairs({
  "target%{1+1}.fixture",
  "project%name",
  "branch%{1+1}",
  "targettype",
  "RO",
  "+7",
  "~3",
  "-2",
  "E1",
}) do
  assert(output:find(value, 1, true), "missing target information: " .. value .. " in " .. output)
end
assert(not output:find("focusedtype", 1, true), "do not read the focused buffer instead")
assert(not output:find("LSP", 1, true), "missing optional producer must not fabricate state")

local top = render("tabline", true)
assert(top:find("focused.fixture", 1, true))
assert(not top:find("targettype", 1, true), "separate instances must not share buffer state")

vim.bo[target].filetype = "changedtype"
vim.bo[target].readonly = false
vim.b[target].gitsigns_head = nil
vim.b[target].gitsigns_status_dict = nil
vim.diagnostic.reset(ns, target)
output = render("statusline")
assert(output:find("changedtype", 1, true), "reflect changed filetype")
for _, stale in ipairs({ "targettype", "branch%{1+1}", "+7", "~3", "-2", "E1", "RO" }) do
  assert(not output:find(stale, 1, true), "stale component state: " .. stale)
end

local special = vim.api.nvim_create_buf(false, true)
vim.api.nvim_buf_set_name(special, "fixture://remote/item")
require("heirline").setup({
  statusline = {
    static = { bufnr = special },
    components.project(),
    components.flags(),
    components.branch(),
    components.git_diff(),
  },
})
assert(render("statusline") == "", "special buffers must not invent project or new-file state")
vim.cmd("qa!")
