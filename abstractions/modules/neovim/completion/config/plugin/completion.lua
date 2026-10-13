require("blink.cmp").setup({
  completion = {
    menu = {
      draw = {
        -- colorful-menu folds label_description into the label.
        columns = { { "kind_icon" }, { "label", gap = 1 } },
        components = {
          label = {
            text = function (ctx)
              return require("colorful-menu").blink_components_text(ctx)
            end,
            highlight = function (ctx)
              return require("colorful-menu").blink_components_highlight(ctx)
            end,
          },
        },
      },
    },
  },
  sources = {
    default = { "lsp", "path", "snippets", "buffer", "ripgrep" },
    providers = {
      buffer = {
        opts = {
          get_bufnrs = function ()
            return { vim.api.nvim_get_current_buf() }
          end,
        },
      },
      ripgrep = {
        module = "blink-ripgrep",
        name = "Ripgrep",
      },
    },
  },
  cmdline = {
    keymap = {
      preset = "cmdline",
      ["<CR>"] = { "accept_and_enter", "fallback" },
    },
    completion = {
      menu = { auto_show = true },
      list = { selection = { preselect = false } },
      ghost_text = { enabled = true },
    },
  },
})
