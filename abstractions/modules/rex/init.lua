-- Rex's key bindings and the actions they run. The rex module links this file
-- as ~/.config/rex/init.lua and reloads it on each switch.
--
-- Cmd keeps the app's own operations, Option those on panes, and Ctrl stays
-- with the programs in the terminal. Shift moves what the key acts on, and
-- Ctrl+Option creates panes. Zellij binds the same keys.

local terminal = "com.superlogical.terminal"

-- A terminal created without a working directory starts in the home
-- directory; Rex's own new tab action passes the current one, which is kept
-- only for panes within a tab.
local function shell()
    return rex.layout.block { flavor = terminal .. ".shell" }
end

-- The window holding the block, or the active window without one.
local function window_of(view, block_id)
    for _, window in ipairs(view.windows or {}) do
        for _, layer in ipairs(window.layers or {}) do
            for _, block in ipairs(layer.blocks or {}) do
                if block.block_id == block_id then return window end
            end
        end
    end
    for _, window in ipairs(view.windows or {}) do
        if window.window_id == view.active_window_id then return window end
    end
end

local function runs_nvim(block_id)
    local process = rex.block.call(terminal, "process", { block_id = block_id })
    local foreground = process and process.foreground
    if foreground == nil then return false end
    for _, name in ipairs({ foreground.name or "", foreground.argv0 or "", foreground.path or "" }) do
        if name:match("n?vim[^/]*$") then return true end
    end
    return false
end

rex.action {
    name = "new_home_tab",
    title = "New Tab in Home Directory",
    run = function ()
        local created = rex.session.new_window { layout = shell(), focus = true }
        local view = rex.session.view {}
        -- The server makes the window active, but the app keeps showing the
        -- tab it had; selecting the window brings the app to it. A key
        -- binding's context carries no session, so the view names it.
        if created ~= nil and view ~= nil then
            rex.client.queue("session.select", {
                session_id = view.session_id,
                window_id = created.window_id
            })
        end
    end
}

-- As Zellij's ToggleFloatingPanes: opens a floating pane when the window has
-- none, and otherwise hides them all, or shows them all when all are hidden.
rex.action {
    name = "toggle_floating",
    title = "Toggle Floating Panes",
    run = function (ctx)
        local view = rex.session.view {}
        local window = view and window_of(view, ctx.block_id)
        if window == nil then return end
        local floating, shown = {}, false
        for _, layer in ipairs(window.layers or {}) do
            if layer.kind ~= "tiled" then
                table.insert(floating, layer)
                shown = shown or layer.state ~= "minimized"
            end
        end
        if #floating == 0 then
            rex.client.queue("pane.new_floating")
            return
        end
        for index, layer in ipairs(floating) do
            rex.session.set_layer_state {
                layer_id = layer.layer_id,
                state = shown and "minimized" or "normal",
                focus = not shown and index == #floating
            }
        end
    end
}

-- Leaves the key to Neovim when it runs in the pane, which moves to the
-- adjacent Rex pane itself once it reaches its own edge.
rex.action {
    name = "smart_focus",
    title = "Focus Pane (pass through to Neovim)",
    args = { direction = "string", key = "string" },
    run = function (ctx, args)
        if ctx.block_id ~= nil and runs_nvim(ctx.block_id) then
            rex.client.queue("pane.send_key", { key = args.key })
        else
            rex.client.queue("pane.focus", { direction = args.direction, wrap = false })
        end
    end
}

-- As Ghostty's reload_config; Rex binds it to Diagnostics.
rex.bind("shift+cmd+,", "client.config.reload")

-- Replaces Settings on cmd+,.
rex.bind("cmd+,", "client.tab.previous")
rex.bind("cmd+.", "client.tab.next")
rex.bind("cmd+t", "new_home_tab")

for key, direction in pairs({ h = "left", j = "down", k = "up", l = "right" }) do
    rex.bind("alt+" .. key, "smart_focus", { direction = direction, key = "alt+" .. key })
    rex.bind("alt+shift+" .. key, "pane.move", { direction = direction })
    rex.bind("ctrl+alt+" .. key, "pane.split", { direction = direction })
end

rex.bind("alt+space", "toggle_floating")
rex.bind("alt+z", "pane.zoom")
