-- Our shortcut prepares its cache rather than relying on another feature to
-- have created it. The fixture deliberately has no finder. Builds cannot
-- establish this runtime prerequisite; observe the filesystem at the provider
-- call rather than retesting the upstream picker or its rendering.
local cache = vim.fn.stdpath("cache")
vim.fn.delete(cache, "rf")
Snacks.picker.undo = function ()
  assert(vim.fn.isdirectory(cache) == 1, "undo requires a prepared cache directory")
end
vim.fn.maparg("<Space>u", "n", false, true).callback()
vim.cmd("qa!")
