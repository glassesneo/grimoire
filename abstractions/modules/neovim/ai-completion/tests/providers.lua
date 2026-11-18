local root = vim.fn.tempname()
vim.fn.mkdir(root, "p")
local file = root .. "/main.lua"
vim.fn.writefile({ "local value = " }, file)
vim.cmd("edit " .. vim.fn.fnameescape(file))
vim.env.AI_MOP_API_KEY = "first-runtime-key"
vim.env.AI_MOP_API_KEY_FILE = nil

local requests = {}
vim.system = function (command)
  local request = { endpoint = command[#command], headers = {} }
  for i, arg in ipairs(command) do
    if arg == "-H" then
      local name, value = command[i + 1]:match("^([^:]+): (.*)$")
      request.headers[name:lower()] = value
    elseif arg == "-d" then
      local path = command[i + 1]:sub(2)
      request.body = vim.json.decode(table.concat(vim.fn.readfile(path), "\n"))
      vim.fn.delete(path)
    end
  end
  table.insert(requests, request)
  return { pid = #requests, kill = function () end }
end
local context = {
  lines_before = "local value = ",
  lines_after = "",
  opts = { is_incomplete_before = false, is_incomplete_after = false },
}
local function request()
  local provider = require("minuet").config.provider
  local before = #requests
  require("minuet.backends." .. provider).complete(context, function () end)
  assert(#requests == before + 1, "selected provider did not send a request")
  return requests[#requests]
end
local function check_openai(sent, key)
  assert(sent.endpoint == "https://openai.invalid/completions", "OpenAI endpoint declaration was lost")
  assert(sent.body.model == "synthetic-openai", "OpenAI model declaration was lost")
  assert(sent.headers.authorization == "Bearer " .. key, "OpenAI runtime credentials were lost")
end
check_openai(request(), "first-runtime-key")

vim.env.AI_MOP_API_KEY = "second-runtime-key"
vim.cmd("Minuet change_provider claude")
local sent = request()
assert(sent.endpoint == "https://anthropic.invalid/messages", "Anthropic endpoint declaration was lost")
assert(sent.body.model == "synthetic-anthropic", "Anthropic model declaration was lost")
assert(sent.headers["x-api-key"] == "second-runtime-key", "Anthropic runtime credentials were lost")

vim.cmd("Minuet change_provider openai_compatible")
check_openai(request(), "second-runtime-key")
vim.fn.delete(root, "rf")
print("Declared provider routes and runtime credentials verified across switching")
vim.cmd("qa!")
