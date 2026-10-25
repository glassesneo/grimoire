pragma ComponentBehavior: Bound
import QtQuick
import Vicinae

/// Reusable delegate base for list items.  Provides a Source-blended
/// rounded-rect background that highlights on selection/hover, a MouseArea
/// for click handling, and a content slot for view-specific layouts.
Item {
    id: root

    property bool selected: false
    property bool draggable: false
    property int quickAccessIndex: -1
    readonly property LauncherAppearance appearance: (root.Window.window as LauncherWindow)?.appearance ?? fallbackAppearance
    readonly property bool hovered: mouseArea.containsMouse && HoverActivation.active
    readonly property bool quickAccessActive: Launcher.commandHeld && quickAccessIndex >= 0 && !Launcher.alertModel.visible && !Launcher.actionPanel.open && !Launcher.footerPanel.open && !Launcher.hasOverlay

    LauncherAppearance {
        id: fallbackAppearance
    }

    default property alias contentData: contentItem.data

    signal clicked
    signal activated
    signal dragRequested(var source)

    DraggableMouseArea {
        id: mouseArea
        anchors.fill: parent
        hoverEnabled: true
        draggable: root.draggable
        onItemClicked: {
            root.clicked();
            if (Config.activateOnSingleClick)
                root.activated();
        }
        onItemActivated: root.activated()
        onDragRequested: root.dragRequested(root)
    }

    SourceBlendRect {
        anchors.fill: parent
        anchors.leftMargin: root.appearance.rowInset
        anchors.rightMargin: root.appearance.rowInset
        radius: root.appearance.rowRadius
        // Selection fill is the list's floating highlight; hover stays here.
        backgroundColor: {
            if (root.selected || !root.hovered)
                return "transparent";
            return root.appearance.delegateBackdrop;
        }
        color: {
            if (root.selected || !root.hovered)
                return "transparent";
            return root.appearance.hoverFill;
        }
    }

    Item {
        id: contentItem
        anchors.fill: parent
    }
}
