require("zellij-nav").setup()

for key, direction in pairs({ h = "Left", j = "Down", k = "Up", l = "Right" }) do
  vim.keymap.set("n", "<M-" .. key .. ">", "<Cmd>ZellijNavigate" .. direction .. "<CR>", {
    silent = true,
    desc = "Navigate " .. direction:lower(),
  })
end
