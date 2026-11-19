assert(vim.v.errmsg == "", vim.v.errmsg)
local view = require("noice.view.backend.grimoire_cmdline")({
  relative = "editor",
  size = { width = 60, height = 1 },
  position = { row = 3, col = "50%" },
  border = { style = "rounded", padding = { 0, 1 } },
})
view:show()
local function width(columns)
  vim.o.columns = columns
  vim.api.nvim_exec_autocmds("VimResized", {})
  local smallest
  for _, win in ipairs(vim.api.nvim_list_wins()) do
    if vim.api.nvim_win_get_config(win).relative ~= "" then
      local actual = vim.api.nvim_win_get_width(win)
      smallest = math.min(smallest or actual, actual)
    end
  end
  return assert(smallest, "popup is missing")
end

local preferred = width(160)
assert(preferred > 0 and preferred <= 156)
for _, columns in ipairs({ 12, 20, 42, 64, 100 }) do
  local actual = width(columns)
  assert(actual > 0 and actual <= columns - 4, "popup exceeds the editor margins")
  assert(actual <= preferred, "popup exceeds its preferred width")
end
assert(width(160) == preferred, "popup does not recover its preferred width")
vim.cmd("qa!")
