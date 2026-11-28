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

local function can_request()
  return M.allowed() and M.api_key() ~= nil
end

local initialized = false

function M.setup()
  if initialized then
    return
  end
  initialized = true
  local settings = vim.g.grimoire_ai_completion
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
    enable_predicates = { can_request },
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
end

function M.register()
  local function map_cycle(lhs, direction, desc)
    vim.keymap.set("i", lhs, function ()
      if can_request() then
        M.setup()
        require("minuet.virtualtext").action[direction]()
      end
    end, { desc = desc }
    )
  end
  map_cycle("<C-,>", "prev", "Minuet: previous candidate or request completion")
  map_cycle("<C-.>", "next", "Minuet: next candidate or request completion")

  table.insert(require("grimoire.inline_completion").sources, function ()
    local vt = package.loaded["minuet.virtualtext"]
    if vt and vt.action.is_visible() then
      vt.action.accept()
      return true
    end
    return false
  end)

  vim.api.nvim_create_autocmd({ "BufReadPre", "BufNewFile", "InsertEnter" }, {
    group = vim.api.nvim_create_augroup("grimoire.ai_completion.load", { clear = true }),
    once = true,
    callback = function ()
      M.setup()
    end,
  })
end

return M
