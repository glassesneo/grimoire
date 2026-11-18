local action = require("minuet.virtualtext").action
local mapping = vim.fn.maparg("<C-e>", "i", false, true).callback
assert(type(mapping) == "function", "Ctrl-E must have a callback")
local visible, native = false, false
local minuet_calls, native_calls = 0, 0

action.is_visible = function ()
  return visible
end
action.accept = function ()
  minuet_calls = minuet_calls + 1
end
vim.lsp.inline_completion.get = function ()
  native_calls = native_calls + 1
  return native
end

visible, native = true, true
assert(mapping() == "")
assert(minuet_calls == 1 and native_calls == 0, "visible Minuet suggestion must take precedence")

visible = false
assert(mapping() == "")
assert(minuet_calls == 1 and native_calls == 1, "native inline acceptance must remain available")

native = false
assert(mapping() == "<C-o>$", "without suggestions Ctrl-E must move to end of line")
assert(minuet_calls == 1 and native_calls == 2)
print("Inline completion acceptance and fallback verified")
vim.cmd("qa!")
