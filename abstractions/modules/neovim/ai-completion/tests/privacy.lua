local root = vim.fn.tempname()
vim.fn.mkdir(root, "p")
vim.env.AI_MOP_API_KEY = "synthetic-key"
vim.env.AI_MOP_API_KEY_FILE = nil
local config = require("minuet").config
local policy = require("grimoire.ai_completion")
local sent = 0
vim.system = function (command)
  sent = sent + 1
  for _, arg in ipairs(command) do
    if arg:sub(1, 1) == "@" then
      vim.fn.delete(arg:sub(2))
    end
  end
  return { pid = sent, kill = function () end }
end
local context = {
  lines_before = "local value = ",
  lines_after = "",
  opts = { is_incomplete_before = false, is_incomplete_after = false },
}
local function attempt(allowed)
  assert(config.enable_predicates[1]() == allowed, "automatic request policy differs")
  for _, provider in ipairs({ "openai_compatible", "claude" }) do
    vim.cmd("Minuet change_provider " .. provider)
    local before = sent
    pcall(require("minuet.backends." .. provider).complete, context, function () end)
    assert(
      sent == before + (allowed and 1 or 0),
      provider .. ": manual request bypassed the policy or allowed request was blocked"
    )
  end
end
local function edit(name, exists)
  local file = root .. "/" .. name
  if exists then
    vim.fn.writefile({ "local value = " }, file)
  end
  vim.cmd("edit! " .. vim.fn.fnameescape(file))
end

edit("main.lua", true)
attempt(true)

for _, name in ipairs({ "config.lua", "local.lua", "private.txt" }) do
  edit(name, true)
  attempt(true)
end
for _, name in ipairs({ ".env", ".env.production" }) do
  edit(name, true)
  attempt(false)
end
edit("new.lua", false)
attempt(false)
edit("main.lua", true)
vim.bo.buflisted = false
attempt(false)
vim.bo.buflisted = true
vim.bo.buftype = "nofile"
attempt(false)
vim.bo.buftype = ""

local alias = root .. "/alias.lua"
assert(vim.uv.fs_symlink(root .. "/.env", alias))
vim.cmd("edit! " .. vim.fn.fnameescape(alias))
attempt(false)
vim.cmd("enew!")
attempt(false)

edit("main.lua", true)
vim.env.AI_MOP_API_KEY = nil
assert(not config.enable_predicates[1](), "missing credentials must disable automatic requests")
local file = root .. "/key.txt"
vim.fn.writefile({ "  file-key  " }, file)
vim.env.AI_MOP_API_KEY_FILE = file
assert(policy.api_key() == "file-key", "key files must be read at runtime and trimmed")
vim.env.AI_MOP_API_KEY = "  environment-key  "
assert(policy.api_key() == "environment-key", "environment key must take precedence")
vim.env.AI_MOP_API_KEY = nil
vim.fn.delete(file)
assert(policy.api_key() == nil, "unreadable key files must not enable automatic requests")
vim.fn.delete(root, "rf")
print("Automatic and manual outbound privacy and runtime credentials verified")
vim.cmd("qa!")
