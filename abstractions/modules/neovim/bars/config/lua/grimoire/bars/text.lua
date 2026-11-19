local M = {}

local function take(value, budget, from_end)
  local result = ""
  local count = vim.fn.strchars(value, true)
  for offset = 0, count - 1 do
    local index = from_end and (count - offset - 1) or offset
    local char = vim.fn.strcharpart(value, index, 1, true)
    local candidate = from_end and (char .. result) or (result .. char)
    if vim.fn.strdisplaywidth(candidate) > budget then
      break
    end
    result = candidate
  end
  return result
end

function M.middle(value, width)
  if width <= 0 then
    return ""
  end
  if vim.fn.strdisplaywidth(value) <= width then
    return value
  end
  local remaining = width - vim.fn.strdisplaywidth("…")
  local first = take(value, math.ceil(remaining / 2), false)
  local last = take(value, remaining - vim.fn.strdisplaywidth(first), true)
  return first .. "…" .. last
end

return M
