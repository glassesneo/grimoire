local action = require("minuet.virtualtext").action
local calls = {}
action.prev = function ()
  calls[#calls + 1] = "previous"
end
action.next = function ()
  calls[#calls + 1] = "next"
end

local previous = vim.fn.maparg("<C-,>", "i", false, true).callback
local next_candidate = vim.fn.maparg("<C-.>", "i", false, true).callback
assert(type(previous) == "function" and type(next_candidate) == "function", "candidate mappings are missing")

local file = vim.fn.tempname() .. ".lua"
vim.fn.writefile({ "local value = " }, file)
vim.cmd.edit(vim.fn.fnameescape(file))
vim.env.AI_MOP_API_KEY = "synthetic-key"
vim.env.AI_MOP_API_KEY_FILE = nil

assert(not action.is_visible(), "test must start without a displayed candidate")
previous()
next_candidate()
assert(vim.deep_equal(calls, { "previous", "next" }), "keys must invoke Minuet even without a candidate")

vim.env.AI_MOP_API_KEY = nil
previous()
next_candidate()
assert(#calls == 2, "keys must not invoke Minuet without credentials")

vim.env.AI_MOP_API_KEY = "synthetic-key"
vim.cmd.enew()
previous()
next_candidate()
assert(#calls == 2, "keys must not invoke Minuet in an excluded buffer")

vim.fn.delete(file)
print("Minuet candidate navigation and manual request gating verified")
vim.cmd("qa!")
