local M = {}

local function buffer(self)
  return self.bufnr or vim.api.nvim_get_current_buf()
end

local function text(provider, hl)
  return {
    init = function (self)
      self.label = vim.fn.strtrans(provider(buffer(self)) or "")
    end,
    provider = function (self)
      return self.label:gsub("%%", "%%%%")
    end,
    hl = hl,
  }
end

function M.filename()
  return text(function (buf)
    local name = vim.api.nvim_buf_get_name(buf)
    return name == "" and "[No Name]" or vim.fn.fnamemodify(name, ":t")
  end, "Directory")
end

function M.path()
  return text(function (buf)
    local name = vim.api.nvim_buf_get_name(buf)
    return name == "" and "[No Name]" or vim.fn.fnamemodify(name, ":.")
  end, "Directory")
end

local project_cache = {}
local readable_cache = {}
local hl_cache = {}

local cache_group = vim.api.nvim_create_augroup("grimoire.bars.cache", { clear = true })
vim.api.nvim_create_autocmd("BufWipeout", {
  group = cache_group,
  callback = function (args)
    project_cache[args.buf] = nil
    readable_cache[args.buf] = nil
  end,
})
vim.api.nvim_create_autocmd("DirChanged", {
  group = cache_group,
  callback = function ()
    project_cache = {}
  end,
})
vim.api.nvim_create_autocmd({ "BufWritePost", "BufReadPost", "BufFilePost" }, {
  group = cache_group,
  callback = function (args)
    readable_cache[args.buf] = nil
  end,
})
vim.api.nvim_create_autocmd("ColorScheme", {
  group = cache_group,
  callback = function ()
    hl_cache = {}
  end,
})

function M.project()
  return text(function (buf)
    if vim.bo[buf].buftype ~= "" then
      return
    end
    local name = vim.api.nvim_buf_get_name(buf)
    if name == "" then
      return
    end
    local cached = project_cache[buf]
    if cached and cached.name == name then
      return cached.value
    end
    local root = vim.fs.root(buf, { ".git" })
    local value = root and vim.fn.fnamemodify(root, ":t") or nil
    project_cache[buf] = { name = name, value = value }
    return value
  end, "Directory")
end

function M.branch()
  return text(function (buf)
    return vim.b[buf].gitsigns_head
  end, "String")
end

function M.flags()
  return text(function (buf)
    local flags = {}
    if vim.bo[buf].modified then
      flags[#flags + 1] = "[+]"
    end
    if vim.bo[buf].readonly or not vim.bo[buf].modifiable then
      flags[#flags + 1] = "[RO]"
    end
    local name = vim.api.nvim_buf_get_name(buf)
    if name ~= "" and vim.bo[buf].buftype == "" and not name:match("^%a[%w+.-]*://") then
      local cached = readable_cache[buf]
      local readable
      if cached and cached.name == name then
        readable = cached.value
      else
        readable = vim.uv.fs_stat(name) ~= nil
        readable_cache[buf] = { name = name, value = readable }
      end
      if not readable then
        flags[#flags + 1] = "[New]"
      end
    end
    return table.concat(flags, " ")
  end)
end

local mode_groups = {
  n = "Function",
  i = "String",
  v = "Special",
  V = "Special",
  ["\22"] = "Special",
  s = "Statement",
  S = "Statement",
  ["\19"] = "Statement",
  R = "Constant",
  c = "Constant",
  r = "Constant",
  ["!"] = "DiagnosticError",
  t = "DiagnosticError",
}

function M.mode(glyphs)
  return {
    provider = (glyphs or "█"):gsub("%%", "%%%%"),
    hl = function ()
      local group = mode_groups[vim.fn.mode(1):sub(1, 1)] or mode_groups.n
      local cached = hl_cache[group]
      if cached then
        return cached
      end
      local fg = vim.api.nvim_get_hl(0, { name = group, link = false }).fg
      local bg = vim.api.nvim_get_hl(0, { name = "StatusLine", link = false }).bg
      local result = { fg = fg or "NONE", bg = bg or "NONE" }
      hl_cache[group] = result
      return result
    end,
  }
end

function M.git_diff()
  local component = {}
  for _, spec in ipairs({
    { "added", "+", "GitSignsAdd" },
    { "changed", "~", "GitSignsChange" },
    { "removed", "-", "GitSignsDelete" },
  }) do
    component[#component + 1] = text(function (buf)
      local count = (vim.b[buf].gitsigns_status_dict or {})[spec[1]] or 0
      return count > 0 and (spec[2] .. count .. " ") or ""
    end, spec[3])
  end
  return component
end

function M.diagnostics()
  local component = {
    init = function (self)
      self.diagnostic_counts = vim.diagnostic.count(buffer(self))
    end,
  }
  for _, spec in ipairs({
    { vim.diagnostic.severity.ERROR, "E", "DiagnosticError" },
    { vim.diagnostic.severity.WARN, "W", "DiagnosticWarn" },
    { vim.diagnostic.severity.INFO, "I", "DiagnosticInfo" },
    { vim.diagnostic.severity.HINT, "H", "DiagnosticHint" },
  }) do
    component[#component + 1] = {
      provider = function (self)
        local count = (self.diagnostic_counts or {})[spec[1]] or 0
        return count > 0 and (spec[2] .. count .. " ") or ""
      end,
      hl = spec[3],
    }
  end
  return component
end

function M.search()
  return text(function (buf)
    if buf ~= vim.api.nvim_get_current_buf() or vim.v.hlsearch == 0 then
      return
    end
    local ok, count = pcall(vim.fn.searchcount, { recompute = true, maxcount = 9999, timeout = 20 })
    if not ok or not count.total or count.total == 0 then
      return
    end
    if count.incomplete == 1 then
      return "[?/?]"
    end
    local total = count.incomplete == 2 and (">" .. count.maxcount) or tostring(count.total)
    return "[" .. count.current .. "/" .. total .. "]"
  end, "Search")
end

function M.lsp()
  return text(function (buf)
    local count = #vim.lsp.get_clients({ bufnr = buf })
    return count > 0 and ("LSP " .. count) or ""
  end)
end

function M.filetype()
  return text(function (buf)
    return vim.bo[buf].filetype
  end, "Type")
end

return M
