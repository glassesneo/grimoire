local function setup()
  local cfg = vim.g.grimoire_animations
  if cfg.edit then
    require("tiny-glimmer").setup({
      overwrite = {
        auto_map = true,
        yank = { enabled = true },
        paste = { enabled = true },
        search = { enabled = false },
        undo = { enabled = true },
        redo = { enabled = true, redo_mapping = "r" },
      },
    })
  end

  if cfg.scroll then
    local star = vim.fn.maparg("*", "n", false, true)
    require("cinnamon").setup({
      keymaps = { basic = true, extra = false },
      options = { mode = "cursor" },
    })
    if next(star) then
      vim.fn.mapset("n", false, star)
    end
  end
end

-- Glimmer wraps existing mappings, including r for redo, so it waits for
-- startup mappings instead of relying on plugin load order.
if vim.v.vim_did_enter == 1 then
  setup()
else
  vim.api.nvim_create_autocmd("VimEnter", {
    group = vim.api.nvim_create_augroup("grimoire.animations", { clear = true }),
    once = true,
    callback = setup,
  })
end
