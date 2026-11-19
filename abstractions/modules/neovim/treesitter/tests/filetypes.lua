local started, stopped = {}, {}
vim.treesitter.start = function (buf, parser)
  started[buf] = parser
end
vim.treesitter.stop = function (buf)
  stopped[buf] = (stopped[buf] or 0) + 1
end
vim.treesitter.query.get = function (parser, query)
  assert(query == "indents")
  return parser == "fixture_parser" and {} or nil
end

local ts_indent = "v:lua.require'nvim-treesitter'.indentexpr()"
local function buffer(filetype, buftype)
  local buf = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_set_current_buf(buf)
  vim.bo[buf].buftype = buftype or ""
  vim.bo[buf].indentexpr = "NativeIndent()"
  vim.wo.foldmethod = "manual"
  vim.bo[buf].filetype = filetype
  assert(vim.wo.foldmethod == "manual", "folding must remain unchanged")
  return buf
end

local full = buffer("fixture_full")
assert(vim.treesitter.language.get_lang("fixture_full") == "fixture_parser", "parser alias")
assert(started[full] == "fixture_parser", "selected highlighting")
assert(vim.bo[full].indentexpr == ts_indent, "selected indentation")

local fallback = buffer("fixture_fallback")
assert(started[fallback] == "fixture_no_indent", "highlight without indent query")
assert(vim.bo[fallback].indentexpr == "NativeIndent()", "missing query must preserve native indentation")

local highlight = buffer("fixture_highlight")
assert(started[highlight] == "fixture_parser")
assert(vim.bo[highlight].indentexpr == "NativeIndent()", "disabled indentation")
local indent = buffer("fixture_indent")
assert(not started[indent], "disabled highlighting")
assert(vim.bo[indent].indentexpr == ts_indent)
for _, spec in ipairs({
  { "fixture_off" },
  { "fixture_unselected" },
  { "fixture_full", "nofile" },
}) do
  local buf = buffer(unpack(spec))
  assert(not started[buf], "excluded buffer must not start highlighting")
  assert(vim.bo[buf].indentexpr == "NativeIndent()", "excluded buffer must retain indentation")
end

vim.bo[full].filetype = "fixture_unselected"
assert(stopped[full] == 1, "release old highlighter")
assert(vim.bo[full].indentexpr == "NativeIndent()", "restore owned indent expression")

vim.bo[indent].indentexpr = "ReplacementIndent()"
vim.bo[indent].filetype = "fixture_unselected"
assert(not stopped[indent], "do not stop highlighting we did not start")
assert(vim.bo[indent].indentexpr == "ReplacementIndent()", "do not overwrite a replacement indent expression")

vim.bo[highlight].filetype = "fixture_indent"
assert(stopped[highlight] == 1, "release before applying new policy")
assert(vim.bo[highlight].indentexpr == ts_indent, "apply new indentation policy")
vim.cmd("qa!")
