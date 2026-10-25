pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Vicinae

Item {
    id: root

    required property SectionListModel listModel

    property alias model: listView.model
    property alias delegate: listView.delegate
    property alias currentIndex: listView.currentIndex
    property alias count: listView.count

    // Optional detail panel — mirrors TypedListView's SplitDetailWidget pattern.
    // `detailComponent` is the template; `detailVisible` toggles per-item
    // (consumer sets it from selectionChanged, just like
    //  m_split->setDetailVisibility(generateDetail(item)) in TypedListView).
    property Component detailComponent: null
    property var detailProps: ({})
    property real detailRatio: 0.65
    property bool detailVisible: false

    property string emptyTitle: qsTr("No results")
    property string emptyDescription: ""
    property var emptyIcon: Img.icon(BuiltinIcon.MagnifyingGlass).withFillColor(Theme.foreground)
    property Component emptyViewComponent: null

    property bool suppressEmpty: false

    readonly property LauncherAppearance _appearance: (root.Window.window as LauncherWindow)?.appearance ?? _fallbackAppearance

    LauncherAppearance {
        id: _fallbackAppearance
    }

    readonly property bool _showDetail: root.detailComponent !== null && root.detailVisible
    readonly property bool _empty: listView.count === 0
    readonly property bool _awaitingData: root.listModel && root.listModel.awaitingData === true

    // When true, GenericListView auto-wires common model signals:
    //  - onModelReset → selectFirst + setSelectedIndex
    //  - onItemSelected → setSelectedIndex
    //  - onItemActivated → activateSelected
    // Consumers only need to set listModel; no Connections block required.
    property bool autoWireModel: false

    // When false, onModelReset preserves the current selection index
    // instead of jumping to the first item. Useful for data refreshes
    // where the list content updates without the user changing the search text.
    property bool selectFirstOnReset: true

    signal itemActivated(int index)
    signal itemSelected(int index)

    // Infinite-scroll pagination: consumers opt in by setting canLoadMore.
    // endReached fires at most once per content growth cycle.
    signal endReached
    property bool canLoadMore: false
    property real endReachedThreshold: root.height * 1.5
    property bool _endArmed: true

    onCanLoadMoreChanged: {
        if (canLoadMore) {
            _endArmed = true;
            Qt.callLater(_maybeFireEnd);
        }
    }

    function _maybeFireEnd() {
        if (!root.canLoadMore || !root._endArmed)
            return;
        if (listView.contentHeight <= 0)
            return;
        const underfilled = !viewport.scrollable;
        if (!underfilled && listView.atYBeginning)
            return;
        if (listView.contentY + listView.height >= listView.contentHeight - root.endReachedThreshold) {
            root._endArmed = false;
            root.endReached();
        }
    }

    readonly property int _selectionMoveDuration: 120

    function sectionScrollTarget(index, direction) {
        if (!root.listModel || typeof root.listModel.scrollTargetIndex !== "function")
            return index;
        return root.listModel.scrollTargetIndex(index, direction);
    }

    function _moveSelection(next) {
        if (next === listView.currentIndex)
            return;
        listView._animateHighlight = true;
        listView.currentIndex = next;
        const scrollTarget = sectionScrollTarget(next, -1);
        viewport.revealIndex(scrollTarget, ListView.Contain, next);
        Qt.callLater(function () {
            listView._animateHighlight = false;
        });
    }

    function revealCurrentSectionHeaderIfHidden() {
        if (listView.currentIndex < 0)
            return false;

        const scrollTarget = sectionScrollTarget(listView.currentIndex, -1);
        if (scrollTarget === listView.currentIndex)
            return false;

        const previousContentY = listView.contentY;
        viewport.revealIndex(scrollTarget);
        return Math.abs(listView.contentY - previousContentY) > 0.5;
    }

    function moveDown() {
        _moveSelection(root.listModel.nextSelectableIndex(listView.currentIndex, 1));
        return true;
    }

    function moveUp() {
        if (revealCurrentSectionHeaderIfHidden())
            return true;

        _moveSelection(root.listModel.nextSelectableIndex(listView.currentIndex, -1));
        return true;
    }

    function moveSectionDown() {
        if (typeof root.listModel.nextSectionIndex !== "function") {
            return moveDown();
        }
        _moveSelection(root.listModel.nextSectionIndex(listView.currentIndex, 1));
        return true;
    }

    function moveSectionUp() {
        if (typeof root.listModel.nextSectionIndex !== "function") {
            return moveUp();
        }
        if (revealCurrentSectionHeaderIfHidden())
            return true;

        _moveSelection(root.listModel.nextSectionIndex(listView.currentIndex, -1));
        return true;
    }

    function selectFirst() {
        listView._animateHighlight = false;
        listView.currentIndex = root.listModel.nextSelectableIndex(-1, 1);
        listView._syncHighlight();
    }

    onListModelChanged: {
        if (root.autoWireModel && root.listModel && listView.count > 0) {
            root.selectFirst();
            root.listModel.setSelectedIndex(listView.currentIndex);
        }
    }

    Connections {
        enabled: root.autoWireModel && root.listModel
        target: root.listModel
        function onModelReset() {
            if (root.selectFirstOnReset || listView.currentIndex < 0 || listView.currentIndex >= listView.count) {
                root.selectFirst();
                if (viewport.topInset > 0)
                    Qt.callLater(viewport.resetPosition);
            }
            if (root.listModel)
                root.listModel.setSelectedIndex(listView.currentIndex);
        }
    }

    Connections {
        target: root.listModel
        function onModelReset() {
            listView._animateHighlight = false;
            root._endArmed = true;
            listView._lastContentHeight = 0;
            Qt.callLater(function () {
                listView._syncHighlight();
                root._maybeFireEnd();
            });
        }
    }

    HoverResetOnModelChange {
        target: root.listModel
    }

    Connections {
        target: (root.autoWireModel && root.listModel && ("selectedIndex" in root.listModel)) ? root.listModel : null
        function onSelectedIndexChanged() {
            const idx = root.listModel.selectedIndex;
            if (listView.currentIndex !== idx)
                listView.currentIndex = idx;
        }
    }

    onItemSelected: function (index) {
        if (root.autoWireModel && root.listModel)
            root.listModel.setSelectedIndex(index);
    }
    onItemActivated: function (index) {
        if (root.autoWireModel && root.listModel)
            root.listModel.activateSelected();
    }

    RowLayout {
        anchors.fill: parent
        spacing: 0
        visible: !root._empty

        ListScrollViewport {
            id: viewport
            Layout.fillWidth: true
            Layout.fillHeight: true
            list: listView
            topPadding: 4
            bottomPadding: 4

            ListView {
                id: listView
                anchors.fill: parent
                clip: true
                reuseItems: true
                cacheBuffer: 200
                interactive: false
                boundsBehavior: Flickable.StopAtBounds
                highlightFollowsCurrentItem: false
                highlightMoveDuration: 0
                currentIndex: -1

                property real _lastContentHeight: 0
                property bool _animateHighlight: false
                property real _highlightY: 0
                property real _highlightH: 0

                function _syncHighlight() {
                    const item = currentItem;
                    if (!item)
                        return;
                    _highlightY = item.y;
                    _highlightH = item.height;
                }

                onContentYChanged: root._maybeFireEnd()
                onContentHeightChanged: {
                    if (contentHeight > _lastContentHeight)
                        root._endArmed = true;
                    _lastContentHeight = contentHeight;
                    root._maybeFireEnd();
                }

                ViciWheelHandler {
                    target: listView
                }

                onCurrentIndexChanged: {
                    root.itemSelected(currentIndex);
                    _syncHighlight();
                }
                onCurrentItemChanged: _syncHighlight()
                onCountChanged: {
                    if (root.autoWireModel && root.listModel && currentIndex < 0 && count > 0) {
                        root.selectFirst();
                        root.listModel.setSelectedIndex(currentIndex);
                    }
                }

                highlight: Item {
                    z: 0
                    enabled: false
                    visible: listView.currentIndex >= 0 && listView._highlightH > 0
                    x: 0
                    width: listView.width
                    y: listView._highlightY
                    height: listView._highlightH

                    Behavior on y {
                        enabled: listView._animateHighlight
                        NumberAnimation {
                            duration: root._selectionMoveDuration
                            easing.type: Easing.OutCubic
                        }
                    }
                    Behavior on height {
                        enabled: listView._animateHighlight
                        NumberAnimation {
                            duration: root._selectionMoveDuration
                            easing.type: Easing.OutCubic
                        }
                    }

                    SourceBlendRect {
                        anchors.fill: parent
                        anchors.leftMargin: root._appearance.rowInset
                        anchors.rightMargin: root._appearance.rowInset
                        radius: root._appearance.rowRadius
                        backgroundColor: root._appearance.delegateBackdrop
                        color: root._appearance.selectionFill
                    }
                }

                ScrollBar.vertical: ViciScrollBar {
                    policy: viewport.scrollable ? ScrollBar.AsNeeded : ScrollBar.AlwaysOff
                }
            }

            QuickAccessOverlay {
                list: listView
                active: Launcher.commandHeld && !Launcher.alertModel.visible && !Launcher.actionPanel.open && !Launcher.footerPanel.open && !Launcher.hasOverlay
                topInset: viewport.topInset
                bottomInset: viewport.bottomInset
            }
        }

        ContentDivider {
            visible: root._showDetail
            vertical: true
            Layout.fillHeight: true
        }

        Loader {
            id: detailLoader
            active: root._showDetail
            visible: active
            sourceComponent: root.detailComponent
            Layout.preferredWidth: root.width * root.detailRatio
            Layout.fillHeight: true
        }
    }

    Loader {
        anchors.fill: parent
        active: root._empty && !root.suppressEmpty && !root._awaitingData
        visible: active
        sourceComponent: root.emptyViewComponent ? root.emptyViewComponent : defaultEmptyView
    }

    Component {
        id: defaultEmptyView
        EmptyView {
            title: root.emptyTitle
            description: root.emptyDescription
            icon: root.emptyIcon
        }
    }
}
