require("zellij-nav").setup()

local rex = vim.env.ZELLIJ == nil and vim.env.REX_BIN_DIR ~= nil and vim.env.REX_BIN_DIR .. "/rex" or nil

for key, direction in pairs({ h = "Left", j = "Down", k = "Up", l = "Right" }) do
  local navigate = "<Cmd>ZellijNavigate" .. direction .. "<CR>"
  if rex ~= nil then
    navigate = function ()
      local window = vim.fn.winnr()
      vim.cmd.wincmd(key)
      if vim.fn.winnr() == window then
        vim.system({ rex, "focus", direction:lower() })
      end
    end
  end
  vim.keymap.set("n", "<M-" .. key .. ">", navigate, {
    silent = true,
    desc = "Navigate " .. direction:lower(),
  })
end
