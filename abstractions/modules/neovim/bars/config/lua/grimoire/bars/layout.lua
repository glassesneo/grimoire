local c = require("grimoire.bars.components")
local M = {}

local function spaced(component)
  local provider = component.provider
  component.provider = function (self)
    local value = provider(self)
    return value == "" and "" or (value .. " ")
  end
  return component
end

function M.statusline(mode_ends)
  return {
    hl = "StatusLine",
    c.mode(mode_ends.left),
    { provider = " " },
    { flexible = 10, c.path(), c.filename() },
    { provider = " " },
    c.flags(),
    { provider = "%<%=" },
    c.git_diff(),
    c.diagnostics(),
    { provider = "%=" },
    spaced(c.search()),
    spaced(c.lsp()),
    c.filetype(),
    { provider = " " },
    c.mode(mode_ends.right),
  }
end

function M.tabline()
  local branch = c.branch()
  local init = branch.init
  branch.init = function (self)
    init(self)
    local budget = math.floor(vim.o.columns * 0.2)
    self.label = require("grimoire.bars.text").middle(self.label, budget - 1)
  end
  local buffer = {
    hl = function (self)
      return {
        fg = vim.api.nvim_get_hl(0, { name = self.is_active and "TabLineSel" or "TabLine", link = false }).fg or "NONE",
        bg = vim.api.nvim_get_hl(0, { name = self.is_active and "TabLineSel" or "TabLine", link = false }).bg or "NONE",
        bold = self.is_active or self.is_visible,
      }
    end,
    { provider = " " },
    spaced(c.filename()),
    c.flags(),
    { provider = " " },
  }
  return { hl = "TabLineFill", require("heirline.utils").make_buflist(buffer), { provider = "%=" }, spaced(branch) }
end

return M
