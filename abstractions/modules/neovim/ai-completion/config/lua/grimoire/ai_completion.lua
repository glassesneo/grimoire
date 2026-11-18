local M = {}

function M.allowed()
  local bufnr = vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(bufnr) or not vim.bo[bufnr].buflisted or vim.bo[bufnr].buftype ~= "" then
    return false
  end

  local path = vim.api.nvim_buf_get_name(bufnr)
  local resolved = vim.uv.fs_realpath(path)
  if not resolved then
    return false
  end
  for _, name in ipairs({ vim.fs.basename(path), vim.fs.basename(resolved) }) do
    if name:find("env", 1, true) then
      return false
    end
  end
  return true
end

function M.api_key()
  local key = vim.env.AI_MOP_API_KEY
  if key and vim.trim(key) ~= "" then
    return vim.trim(key)
  end
  local file = vim.env.AI_MOP_API_KEY_FILE
  if file and file ~= "" then
    local ok, lines = pcall(vim.fn.readfile, file)
    if ok then
      key = vim.trim(table.concat(lines, "\n"))
      if key ~= "" then
        return key
      end
    end
  end
end

function M.setup()
  local settings = vim.g.grimoire_ai_completion
  -- Virtualtext's manual trigger bypasses enable_predicates.
  local transform = {
    function (request)
      if not M.allowed() then
        error("AI completion is not allowed for this buffer")
      end
      return request
    end,
  }
  require("minuet").setup({
    provider = "openai_compatible",
    request_timeout = 10,
    enable_predicates = {
      function ()
        return M.allowed() and M.api_key() ~= nil
      end,
    },
    virtualtext = { auto_trigger_ft = { "*" } },
    provider_options = {
      openai_compatible = {
        name = "INIAD AI MOP",
        model = settings.model,
        end_point = settings.endpoint,
        api_key = M.api_key,
        transform = transform,
      },
      claude = {
        model = settings.anthropic.model,
        end_point = settings.anthropic.endpoint,
        api_key = M.api_key,
        transform = transform,
      },
    },
    duet = { recent_edits = { enabled = false } },
  })

  local action = require("minuet.virtualtext").action
  table.insert(require("grimoire.inline_completion").sources, function ()
    if action.is_visible() then
      action.accept()
      return true
    end
    return false
  end)
end

return M
