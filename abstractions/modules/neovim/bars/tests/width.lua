local middle = require("grimoire.bars.text").middle
local examples = {
  "feature/a-very-long-descriptive-branch-name", "機能/長いブランチの名前/修正",
  "feature/café-combining-characters", "feature/🌸🌸🌸🌸🌸/finish", "feature/%{1+1}-literal-percent",
}
for _, value in ipairs(examples) do
  for width = 0, vim.fn.strdisplaywidth(value) + 1 do
    local output = middle(value, width)
    assert(vim.fn.strdisplaywidth(output) <= width, "display width exceeded for " .. value .. " at " .. width)
    assert(vim.fn.strtrans(output) == output, "split or invalid character in " .. output)
    if width >= vim.fn.strdisplaywidth(value) then
      assert(output == value, "a fitting label must remain unchanged")
    end
  end
end
local shortened = middle("feature/very-long-branch/fix", 15)
assert(shortened:find("feature", 1, true), "preserve the branch prefix")
assert(shortened:sub(-3) == "fix", "preserve the branch suffix")
assert(middle("short", -1) == "", "no label when no space remains")
vim.cmd("qa!")
