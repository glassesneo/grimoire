local M = {}
local ns = vim.api.nvim_create_namespace("grimoire.autopairs")
local pairs_data = {}
local mapped = {}

local function at_cursor()
  local pos = vim.api.nvim_win_get_cursor(0)
  return pos[1] - 1, pos[2]
end

local function is_generated(char)
  local row, col = at_cursor()
  if vim.api.nvim_get_current_line():sub(col + 1, col + 1) ~= char then
    return false
  end
  for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(0, ns, { row, col }, { row, col }, { details = true })) do
    local details = mark[4]
    if not details.invalid and details.end_row == row and details.end_col == col + 1 then
      return true
    end
  end
  return false
end

function M.record(index)
  local pair = pairs_data[index]
  local row, col = at_cursor()
  local line = vim.api.nvim_get_current_line()
  if line:sub(col, col) ~= pair.open or line:sub(col + 1, col + 1) ~= pair.close then
    return
  end
  vim.api.nvim_buf_set_extmark(0, ns, row, col, {
    end_row = row,
    end_col = col + 1,
    right_gravity = true,
    end_right_gravity = false,
    invalidate = true,
    undo_restore = true,
  })
end

function M.setup(data)
  for key in pairs(mapped) do
    vim.keymap.del("i", key)
  end
  mapped = {}
  pairs_data = data
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
  end

  local function map(key, callback)
    vim.keymap.set("i", key, function ()
      if vim.bo.buftype ~= "" then
        return key
      end
      return callback()
    end, { expr = true, desc = "Paired delimiter input" }
    )
    mapped[key] = true
  end

  local openers = {}
  for _, pair in ipairs(data) do
    openers[pair.open] = true
  end

  for index, pair in ipairs(data) do
    map(pair.open, function ()
      if is_generated(pair.open) then
        return "<C-g>U<Right>"
      end
      return pair.open .. pair.close .. "<C-g>U<Left><Cmd>lua require('grimoire.autopairs').record(" .. index .. ")<CR>"
    end)
    if not openers[pair.close] then
      map(pair.close, function ()
        return is_generated(pair.close) and "<C-g>U<Right>" or pair.close
      end)
    end
  end

  map("<BS>", function ()
    local _, col = at_cursor()
    local line = vim.api.nvim_get_current_line()
    for _, pair in ipairs(data) do
      if col > 0 and line:sub(col, col) == pair.open and line:sub(col + 1, col + 1) == pair.close then
        return "<BS><Del>"
      end
    end
    return "<BS>"
  end)

  vim.api.nvim_create_autocmd("BufReadPost", {
    group = vim.api.nvim_create_augroup("grimoire.autopairs", { clear = true }),
    callback = function (event)
      vim.api.nvim_buf_clear_namespace(event.buf, ns, 0, -1)
    end,
  })
end

return M
