local NuiView = require("noice.view.nui")
local View = NuiView:extend("GrimoireCmdline")

function View:init(opts)
  NuiView.init(self, opts)
  vim.api.nvim_create_autocmd("VimResized", {
    group = vim.api.nvim_create_augroup("grimoire.cmdline." .. self._id, { clear = true }),
    callback = function ()
      if self:is_mounted() then
        self:update_layout()
      end
    end,
  })
end

function View:get_layout()
  self._opts.size.width = math.max(1, math.min(60, vim.o.columns - 4))
  return NuiView.get_layout(self)
end

return function (opts)
  opts.type = "popup"
  return View(opts)
end
