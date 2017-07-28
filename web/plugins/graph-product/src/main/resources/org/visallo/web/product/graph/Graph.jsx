define([
    'create-react-class',
    'prop-types',
    './Cytoscape',
    './popoverHelper',
    './styles',
    './GraphEmpty',
    './GraphExtensionViews',
    './popovers/index',
    './collapsedNodeImageHelpers',
    'util/vertex/formatters',
    'util/retina',
    'components/RegistryInjectorHOC'
], function(
    createReactClass,
    PropTypes,
    Cytoscape,
    PopoverHelper,
    styles,
    GraphEmpty,
    GraphExtensionViews,
    Popovers,
    CollapsedNodeImageHelpers,
    F,
    retina,
    RegistryInjectorHOC) {
    'use strict';

    const MaxPathsToFocus = 100;
    const MaxPreviewPopovers = 5;
    const MaxEdgesBetween = 5;

    const noop = function() {};
    const generateCompoundEdgeId = edge => edge.outVertexId + edge.inVertexId + edge.label;
    const isGhost = cyElement => cyElement && cyElement._private && cyElement._private.data && cyElement._private.data.animateTo;
    const isValidElement = cyElement => cyElement && cyElement.is('.c,.v,.e,.partial') && !isGhost(cyElement);
    const isValidNode = cyElement => cyElement && cyElement.is('node.c,node.v,node.partial') && !isGhost(cyElement);
    const edgeDisplay = (label, ontologyRelationships, edges) => {
        const display = label in ontologyRelationships ? ontologyRelationships[label].displayName : '';
        const showNum = edges.length > 1;
        const num = showNum ? ` (${F.number.pretty(edges.length)})` : '';
        return display + num;
    };
    const propTypesElementArrays = { vertices: PropTypes.array, edges: PropTypes.array };
    const propTypesElementObjects = { vertices: PropTypes.object, edges: PropTypes.object };

    let memoizeForStorage = {};
    const memoizeClear = (...prefixes) => {
        if (prefixes.length) {
            memoizeForStorage = _.omit(memoizeForStorage, (v, k) =>
                _.any(prefixes, prefix => k.indexOf(prefix) === 0));
        } else {
            memoizeForStorage = {};
        }
    }
    const memoizeFor = function(key, elements, fn, idFn) {
        if (!key) throw new Error('Cache key must be specified');
        if (!elements) throw new Error('Valid elements should be provided');
        if (!_.isFunction(fn)) throw new Error('Cache creation method should be provided');
        const fullKey = `${key}-${idFn ? idFn() : elements.id}`;
        const cache = memoizeForStorage[fullKey];
        const vertexChanged = cache && (_.isArray(cache.elements) ?
            (
                cache.elements.length !== elements.length ||
                _.any(cache.elements, (ce, i) => ce !== elements[i])
            ) : cache.elements !== elements
        );
        if (cache && !vertexChanged) {
            return cache.value
        }

        memoizeForStorage[fullKey] = { elements, value: fn() };
        return memoizeForStorage[fullKey].value
    }

    const Graph = createReactClass({

        propTypes: {
            workspace: PropTypes.shape({
                editable: PropTypes.bool
            }).isRequired,
            product: PropTypes.shape({
                previewMD5: PropTypes.string,
                extendedData: PropTypes.shape(propTypesElementObjects).isRequired
            }).isRequired,
            uiPreferences: PropTypes.shape({
                edgeLabels: PropTypes.bool
            }).isRequired,
            productElementIds: PropTypes.shape(propTypesElementObjects).isRequired,
            elements: PropTypes.shape({
                vertices: PropTypes.object,
                edges: PropTypes.object
            }).isRequired,
            selection: PropTypes.shape(propTypesElementObjects).isRequired,
            focusing: PropTypes.shape(propTypesElementObjects).isRequired,
            registry: PropTypes.object.isRequired,
            onUpdatePreview: PropTypes.func.isRequired,
            onVertexMenu: PropTypes.func,
            onEdgeMenu: PropTypes.func
        },

        getDefaultProps() {
            return {
                onVertexMenu: noop,
                onEdgeMenu: noop
            }
        },

        getInitialState() {
            return {
                viewport: this.props.viewport || {},
                animatingGhosts: {},
                initialProductDisplay: true,
                draw: null,
                paths: null,
                hovering: null,
                collapsedImageDataUris: {}
            }
        },

        saveViewport(props) {
            var productId = this.props.product.id;
            if (this.currentViewport && productId in this.currentViewport) {
                var viewport = this.currentViewport[productId];
                props.onSaveViewport(productId, viewport);
            }
        },

        componentDidMount() {
            memoizeClear();
            this.cyNodeIdsWithPositionChanges = {};

            this.popoverHelper = new PopoverHelper(this.node, this.cy);
            this.legacyListeners({
                addRelatedDoAdd: (event, data) => {
                    this.props.onAddRelated(this.props.product.id, data.addVertices)
                },
                selectAll: (event, data) => {
                    this.cytoscape.state.cy.elements().select();
                },
                selectConnected: (event, data) => {
                    event.stopPropagation();
                    const cy = this.cytoscape.state.cy;
                    let selected = cy.elements().filter(':selected');

                    if (selected.length === 0) {
                        const id = data.collapsedNodeId || data.vertexId || date.edgeIds[0];
                        selected = cy.getElementById(id);

                        if (selected.length === 0) {
                            cy.edges().filter(edge => edge.data('edgeInfos').some(edgeInfo => edgeInfo.edgeId === id))
                        }
                    }

                    selected.neighborhood('node').select();
                    selected.connectedNodes().select();

                    selected.unselect();
                },
                startVertexConnection: (event, { vertexId, connectionType }) => {
                    this.setState({
                        draw: {
                            vertexId,
                            connectionType
                        }
                    });
                },
                editCollapsedNode: (event, { collapsedNodeId }) => { this.onEditCollapsedNode(collapsedNodeId)},
                renameCollapsedNode: (event, { collapsedNodeId, title }) => {
                    this.props.onRenameCollapsedNode(this.props.product.id, collapsedNodeId, title)
                },
                uncollapse: (event, { collapsedNodeId }) => {
                    this.props.onUncollapseNodes(this.props.product.id, collapsedNodeId);
                },
                menubarToggleDisplay: { node: document, handler: (event, data) => {
                    if (data.name === 'products-full') {
                        this.teardownPreviews();
                    }
                }},
                finishedVertexConnection: this.cancelDraw,
                'zoomOut zoomIn fit': this.onKeyboard,
                createVertex: event => this.createVertex(),
                fileImportSuccess: this.onFileImportSuccess,
                previewVertex: this.previewVertex,
                closePreviewVertex: (event, { vertexId }) => {
                    delete this.detailPopoversMap[vertexId];
                },
                elementsCut: { node: document, handler: (event, { vertexIds }) => {
                    this.props.onRemoveElementIds({ vertexIds, edgeIds: [] });
                }},
                elementsPasted: { node: document, handler: (event, elementIds) => {
                    this.props.onDropElementIds(elementIds)
                }},
                focusPaths: { node: document, handler: this.onFocusPaths },
                defocusPaths: { node: document, handler: this.onDefocusPaths },
                focusPathsAddVertexIds: { node: document, handler: this.onFocusPathsAdd },
                reapplyGraphStylesheet: { node: document, handler: this.reapplyGraphStylesheet }
            });
        },

        componentWillReceiveProps(nextProps) {
            if (nextProps.selection !== this.props.selection) {
                this.resetQueuedSelection(nextProps.selection);
            }
            if (nextProps.registry !== this.props.registry) {
                memoizeClear();
            }
            if (nextProps.concepts !== this.props.concepts ||
                nextProps.relationships !== this.props.relationships) {
                memoizeClear('vertexToCyNode');
            }
            const newExtendedData = nextProps.product.extendedData;
            const oldExtendedData = this.props.product.extendedData;
            if (newExtendedData) {
                let shouldClear = false;
                const ignoredExtendedDataKeys = ['vertices', 'edges', 'unauthorizedEdgeIds', 'compoundNodes'];
                Object.keys(newExtendedData).forEach(key => {
                    if (shouldClear || ignoredExtendedDataKeys.includes(key)) return;
                    if (!oldExtendedData || newExtendedData[key] !== oldExtendedData[key]) {
                        shouldClear = true;
                    }
                })
                if (shouldClear) {
                    memoizeClear(
                        'vertexToCyNode',
                        'org.visallo.graph.edge.class',
                        'org.visallo.graph.edge.transformer',
                        'org.visallo.graph.node.class'
                    );
                }
            }
            if (nextProps.product.id === this.props.product.id) {
                this.setState({ viewport: {}, initialProductDisplay: false })
            } else {
                this.teardownPreviews();
                this.saveViewport(nextProps)
                this.setState({ viewport: nextProps.viewport || {}, initialProductDisplay: true })
            }
        },

        componentWillUnmount() {
            this.removeEvents.forEach(({ node, func, events }) => {
                $(node).off(events, func);
            })

            this.teardownPreviews();
            this.popoverHelper.destroy();
            this.popoverHelper = null;
            this.saveViewport(this.props)
        },

        teardownPreviews(vertexIds) {
            if (this.detailPopoversMap) {
                const updatePreviews = vertexIds || Object.keys(this.detailPopoversMap);
                _.mapObject(this.detailPopoversMap, (e, id) => {
                    if (updatePreviews.includes(id)) {
                        $(e).teardownAllComponents()
                    }
                    delete this.detailPopoversMap[id]
                });
                this.detailPopoversMap = {};
            }
        },

        render() {
            var { viewport, initialProductDisplay, draw, paths } = this.state,
                { panelPadding, registry, workspace, product } = this.props,
                { editable } = workspace,
                { previewMD5 } = product,
                config = {...CONFIGURATION(this.props), ...viewport},
                events = {
                    onSelect: this.onSelect,
                    onRemove: this.onRemove,
                    onUnselect: this.onUnselect,
                    onFree: this.onFree,
                    onLayoutStop: this.onLayoutStop,
                    onPosition: this.onPosition,
                    onReady: this.onReady,
                    onDecorationEvent: this.onDecorationEvent,
                    onMouseOver: this.onMouseOver,
                    onMouseOut: this.onMouseOut,
                    onTap: this.onTap,
                    onTapHold: this.onTapHold,
                    onTapStart: this.onTapStart,
                    onCxtTapStart: this.onTapStart,
                    onCxtTapEnd: this.onCxtTapEnd,
                    onContextTap: this.onContextTap,
                    onPan: this.onViewport,
                    onZoom: this.onViewport
                },
                menuHandlers = {
                    onMenuCreateVertex: this.onMenuCreateVertex,
                    onMenuSelect: this.onMenuSelect,
                    onMenuExport: this.onMenuExport,
                    onCollapseSelectedNodes: this.onCollapseSelectedNodes
                },
                cyElements = this.mapPropsToElements(editable),
                extensionViews = registry['org.visallo.graph.view'];

            return (
                <div ref={r => {this.node = r}} className="org-visallo-graph" style={{ height: '100%' }}>
                    <Cytoscape
                        ref={r => { this.cytoscape = r}}
                        {...events}
                        {...menuHandlers}
                        tools={this.getTools()}
                        initialProductDisplay={initialProductDisplay}
                        hasPreview={Boolean(previewMD5)}
                        config={config}
                        panelPadding={panelPadding}
                        elements={cyElements}
                        drawEdgeToMouseFrom={draw ? _.pick(draw, 'vertexId', 'toVertexId') : null }
                        drawPaths={paths ? _.pick(paths, 'paths', 'sourceId', 'targetId') : null }
                        onGhostFinished={this.props.onGhostFinished}
                        onUpdatePreview={this.onUpdatePreview}
                        editable={editable}
                        reapplyGraphStylesheet={this.reapplyGraphStylesheet}
                    ></Cytoscape>

                    {cyElements.nodes.length === 0 ? (
                        <GraphEmpty editable={editable} panelPadding={panelPadding} onSearch={this.props.onSearch} onCreate={this.onCreate} />
                    ) : null}

                    { extensionViews.length ? (
                        <GraphExtensionViews views={extensionViews} panelPadding={panelPadding} />
                    ) : null }
                </div>
            )
        },

        onFocusPaths(event, data) {
            if (data.paths.length > MaxPathsToFocus) {
                data.paths = data.paths.slice(0, MaxPathsToFocus);
                $(document).trigger('displayInformation', { message: 'Too many paths to show, will display the first ' + MaxPathsToFocus })
            }
            this.setState({
                paths: data
            })
        },

        onFocusPathsAdd(event) {
            const { paths } = this.state;
            if (paths) {
                const limitedPaths = paths.paths.slice(0, MaxPathsToFocus);
                const vertexIds = _.chain(limitedPaths).flatten().uniq().value();
                this.props.onDropElementIds({ vertexIds });
            }
        },

        onDefocusPaths(event, data) {
            if (this.state.paths) {
                this.setState({ paths: null });
            }
        },

        onCreate() {
            this.createVertex();
        },

        reapplyGraphStylesheet() {
            memoizeClear();
            this.forceUpdate();
        },

        getTools() {
            /**
             * @typedef org.visallo.graph.options~Component
             * @property {object} cy The cytoscape instance
             * @property {object} product The graph product
             */
            return this.props.registry['org.visallo.graph.options'].map(e => ({
                identifier: e.identifier,
                componentPath: e.optionComponentPath,
                product: this.props.product
            }));
        },

        onReady({ cy }) {
            this.cy = cy;
        },

        onDecorationEvent(event) {
            const { cy, target } = event;
            const decoration = decorationForId(target.id());
            if (decoration) {
                const handlerName = {
                    /**
                     * @callback org.visallo.graph.node.decoration~onClick
                     * @this The decoration cytoscape node
                     * @param {object} event The {@link http://js.cytoscape.org/#events/event-object|Cytoscape event} object
                     * @param {object} data
                     * @param {object} data.vertex The vertex this decoration
                     * is attached
                     * @param {object} data.cy The cytoscape instance
                     */
                    tap: 'onClick',
                    /**
                     * @callback org.visallo.graph.node.decoration~onMouseOver
                     * @this The decoration cytoscape node
                     * @param {object} event The {@link http://js.cytoscape.org/#events/event-object|Cytoscape event} object
                     * @param {object} data
                     * @param {object} data.vertex The vertex this decoration
                     * is attached
                     * @param {object} data.cy The cytoscape instance
                     */
                    mouseover: 'onMouseOver',
                    /**
                     * @callback org.visallo.graph.node.decoration~onMouseOut
                     * @this The decoration cytoscape node
                     * @param {object} event The {@link http://js.cytoscape.org/#events/event-object|Cytoscape event} object
                     * @param {object} data
                     * @param {object} data.vertex The vertex this decoration
                     * is attached
                     * @param {object} data.cy The cytoscape instance
                     */
                    mouseout: 'onMouseOut'
                }[event.type];
                if (_.isFunction(decoration.onClick)) {
                    if (handlerName === 'onMouseOver') {
                        this.node.style.cursor = 'pointer';
                    } else if (handlerName === 'onMouseOut' || handlerName === 'onClick') {
                        this.node.style.cursor = null;
                    }
                }
                if (_.isFunction(decoration[handlerName])) {
                    decoration[handlerName].call(target, event, {
                        cy,
                        vertex: target.data('vertex')
                    });
                }
            }
        },

        onMouseOver({ cy, target }) {
            clearTimeout(this.hoverMouseOverTimeout);

            if (target !== cy && target.is('node.v')) {
                this.hoverMouseOverTimeout = _.delay(() => {
                    if (target.data('isTruncated')) {
                        var nId = target.id();
                        this.setState({ hovering: nId })
                    }
                }, 500);
            }
        },

        onMouseOut({ cy, target }) {
            clearTimeout(this.hoverMouseOverTimeout);
            if (target !== cy && target.is('node.v')) {
                if (this.state.hovering) {
                    this.setState({ hovering: null })
                }
            }
        },

        onFileImportSuccess(event, { vertexIds, position }) {
            const { x, y } = position;
            const { left, top } = this.node.getBoundingClientRect();
            const pos = this.droppableTransformPosition({
                x: x - left,
                y: y - top
            });
            this.props.onDropElementIds({vertexIds}, pos);
        },

        onKeyboard(event) {
            const { type } = event;
            const cytoscape = this.cytoscape;

            switch (type) {
                case 'fit': cytoscape.fit();
                    break;
                case 'zoomIn': cytoscape.onControlsZoom('in')
                    break;
                case 'zoomOut': cytoscape.onControlsZoom('out')
                    break;
                default:
                    console.warn(type);
            }
        },

        onMenuSelect(identifier) {
            const cy = this.cytoscape.state.cy;
            const selector = _.findWhere(
                this.props.registry['org.visallo.graph.selection'],
                { identifier }
            );
            if (selector) {
                selector(cy);
            }
        },

        onMenuExport(componentPath) {
            var exporter = _.findWhere(
                    this.props.registry['org.visallo.graph.export'],
                    { componentPath }
                );

            if (exporter) {
                const cy = this.cytoscape.state.cy;
                const { product } = this.props;
                Promise.require('util/popovers/exportWorkspace/exportWorkspace').then(ExportWorkspace => {
                    ExportWorkspace.attachTo(cy.container(), {
                        exporter: exporter,
                        workspaceId: product.workspaceId,
                        productId: product.id,
                        cy: cy,
                        anchorTo: {
                            page: {
                                x: window.lastMousePositionX,
                                y: window.lastMousePositionY
                            }
                        }
                    });
                });
            }
        },

        onCollapseSelectedNodes(nodes) {
            const { product, productElementIds, rootId } = this.props;
            const collapsedNodes = product.extendedData.compoundNodes;

            if (nodes.length < 2) return;

            const children = nodes.map(node => node.id());
            const positions = nodes.map(node => retina.pixelsToPoints(node.position()));
            const pos = {
                x: Math.round(positions.reduce((total, pos) => total + pos.x, 0) / positions.length),
                y: Math.round(positions.reduce((total, pos) => total + pos.y, 0) / positions.length)
            };

            this.props.onCollapseNodes(product.id, {
                children,
                pos,
                parent: rootId
            });

            let vertexIds = [];
            _.each(nodes, node => {
                if (node.data('vertexIds')) {
                    vertexIds = vertexIds.concat(node.data('vertexIds'));
                } else {
                    vertexIds.push(node.id());
                }
            });
            this.teardownPreviews(vertexIds);
        },

        onMenuCreateVertex({pageX, pageY }) {
            const position = { x: pageX, y: pageY };
            this.createVertex(position);
        },

        previewVertex(event, data) {
            const cy = this.cytoscape.state.cy;

            Promise.all([
                Promise.require('util/popovers/detail/detail'),
                F.vertex.getVertexIdsFromDataEventOrCurrentSelection(data, { async: true })
            ]).spread((DetailPopover, ids) => {
                if (!this.detailPopoversMap) {
                    this.detailPopoversMap = {};
                }
                const currentPopovers = Object.keys(this.detailPopoversMap);
                const remove = _.intersection(ids, currentPopovers);
                var add = _.difference(ids, currentPopovers)

                remove.forEach(id => {
                    const cyNode = cy.getElementById(id);
                    if (cyNode.length) {
                        $(this.detailPopoversMap[id]).teardownAllComponents().remove();
                        delete this.detailPopoversMap[id];
                    }
                })
                const availableToOpen = MaxPreviewPopovers - (currentPopovers.length - remove.length);
                if (add.length && add.length > availableToOpen) {
                    $(this.node).trigger('displayInformation', { message: i18n('popovers.preview_vertex.too_many', MaxPreviewPopovers) });
                    add = add.slice(0, Math.max(0, availableToOpen));
                }

                add.forEach(id => {
                    var $popover = $('<div>').addClass('graphDetailPanePopover').appendTo(this.node);
                    this.detailPopoversMap[id] = $popover[0];
                    DetailPopover.attachTo($popover[0], {
                        vertexId: id,
                        anchorTo: {
                            vertexId: id
                        }
                    });
                })
            });
        },

        createVertex(position) {
            if (!position) {
                position = { x: window.lastMousePositionX, y: window.lastMousePositionY };
            }

            if (this.props.workspace.editable) {
                Promise.require('util/popovers/fileImport/fileImport')
                    .then(CreateVertex => {
                        CreateVertex.attachTo(this.node, {
                            anchorTo: { page: position }
                        });
                    });
            }
        },

        onEditCollapsedNode(collapsedNodeId) {
            const collapsedNode = this.cytoscape.state.cy.getElementById(collapsedNodeId);
            if (this.props.workspace.editable && collapsedNode) {
                Promise.require('org/visallo/web/product/graph/popovers/collapsedNode/collapsedNodePopoverShim')
                    .then(CollapsedNodePopover => {
                        CollapsedNodePopover.attachTo(this.node, {
                            cy: this.cytoscape.state.cy,
                            cyNode: collapsedNode,
                            props: {
                                onRename: this.props.onRenameCollapsedNode.bind(this, this.props.product.id, collapsedNodeId),
                                collapsedNodeId: collapsedNodeId
                            },
                            teardownOnTap: true
                        });
                    });
            }
        },

        onUpdatePreview(data) {
            this.props.onUpdatePreview(this.props.product.id, data)
        },

        cancelDraw() {
            const cy = this.cytoscape.state.cy;
            cy.autoungrabify(false);
            this.setState({ draw: null })
        },

        onTapHold({ cy, target }) {
            if (cy !== target) {
                this.previewVertex(null, { vertexId: target.id() })
            }
        },

        onTapStart(event) {
            const { cy, target } = event;
            if (cy !== target && event.originalEvent.ctrlKey) {
                cy.autoungrabify(true);
                if (target.hasClass('v')) {
                    this.setState({
                        draw: {
                            vertexId: target.id()
                        }
                    });
                }
            }
        },

        onTap(event) {
            const { cy, target, position } = event;
            const { x, y } = position;
            const { ctrlKey, shiftKey } = event.originalEvent;
            const { draw, paths } = this.state;

            if (paths) {
                if (cy === target && _.isEmpty(this.props.selection.vertices) && _.isEmpty(this.props.selection.edges)) {
                    $(document).trigger('defocusPaths');
                    this.setState({ paths: null })
                }
            }
            if (draw) {
                const upElement = cy.renderer().findNearestElement(x, y, true, false);
                if (!upElement || draw.vertexId === upElement.id()) {
                    this.cancelDraw();
                    if (ctrlKey && upElement) {
                        this.onContextTap(event);
                    }
                } else if (!upElement.hasClass('v')) {
                    this.cancelDraw();
                } else {
                    this.setState({ draw: {...draw, toVertexId: upElement.id() } });
                    this.showConnectionPopover();
                }
            } else {
                if (ctrlKey) {
                    this.onContextTap(event);
                } else if (!shiftKey && cy === target) {
                    this.coalesceSelection('clear');
                    this.props.onClearSelection();
                }
            }
        },

        onCxtTapEnd(event) {
            const { cy, target } = event;
            if (cy !== target && event.originalEvent.ctrlKey) {
                this.onTap(event);
            }
        },

        onContextTap(event) {
            const { target, cy, originalEvent } = event;
            // TODO: show all selected objects if not on item
            if (target !== cy) {
                const { pageX, pageY } = originalEvent;
                if (target.is('node.c')) {
                    this.props.onCollapsedItemMenu(originalEvent.target, target.id(), { x: pageX, y: pageY });
                } else if (target.isNode()) {
                    this.props.onVertexMenu(originalEvent.target, target.id(), { x: pageX, y: pageY });
                } else {
                    const edgeIds = _.pluck(target.data('edgeInfos'), 'edgeId');
                    this.props.onEdgeMenu(originalEvent.target, edgeIds, { x: pageX, y: pageY });
                }
            }
        },

        onRemove({ target }) {
            if (isValidElement(target)) {
                this.coalesceSelection('remove', getCyItemTypeAsString(target), target);
            }
        },

        onSelect({ target }) {
            if (isValidElement(target)) {
                this.coalesceSelection('add', getCyItemTypeAsString(target), target);
            }
        },

        onUnselect({ target }) {
            if (isValidElement(target)) {
                this.coalesceSelection('remove', getCyItemTypeAsString(target), target);
            }
        },

        onLayoutStop() {
            this.sendPositionUpdates();
        },

        onFree() {
            this.sendPositionUpdates();
        },

        sendPositionUpdates() {
            const { vertices, compoundNodes: collapsedNodes } = this.props.product.extendedData;

            if (!_.isEmpty(this.cyNodeIdsWithPositionChanges)) {
                const positionUpdates = _.mapObject(this.cyNodeIdsWithPositionChanges, (cyNode, id) => {
                    const update = vertices[id] || collapsedNodes[id];
                    update.pos = retina.pixelsToPoints(cyNode.position());
                    return update;
                });

                this.props.onUpdatePositions(
                    this.props.product.id,
                    positionUpdates
                );
                this.cyNodeIdsWithPositionChanges = {};
            }
        },

        onPosition({ target }) {
            if (isValidNode(target)) {
                var id = target.id();
                this.cyNodeIdsWithPositionChanges[id] = target;
            }
        },

        onViewport({ cy }) {
            var zoom = cy.zoom(), pan = cy.pan();
            if (!this.currentViewport) this.currentViewport = {};
            const viewport = { zoom, pan: {...pan}};
            this.currentViewport[this.props.product.id] = viewport;
        },

        droppableTransformPosition(rpos) {
            const cy = this.cytoscape.state.cy;
            const pan = cy.pan();
            const zoom = cy.zoom();
            return retina.pixelsToPoints({
                x: (rpos.x - pan.x) / zoom,
                y: (rpos.y - pan.y) / zoom
            });
        },

        getRootNode() {
            const { product, productElementIds, rootId } = this.props;
            const productVertices = productElementIds.vertices;
            const collapsedNodes = product.extendedData.compoundNodes;

            if (collapsedNodes[rootId] && collapsedNodes[rootId].visible) {
                return collapsedNodes[id];
            } else {
                const children = [];

                [productVertices, collapsedNodes].forEach((type) => {
                    _.mapObject(type, (item, id) => {
                        if (item.parent === 'root') {
                           children.push(id);
                        }
                    })
                });

                return { id: 'root', children }
            }
        },

        mapPropsToElements(editable) {
            const { selection, ghosts, productElementIds, elements, relationships, registry, focusing, product } = this.props;
            const { hovering, collapsedImageDataUris } = this.state;
            const { vertices: productVertices, edges: productEdges } = productElementIds;
            const { vertices, edges } = elements;
            const { vertices: verticesSelectedById, edges: edgesSelectedById } = selection;
            const collapsedNodes = _.pick(product.extendedData.compoundNodes, ({ visible }) => visible);

            const rootNode = this.getRootNode();
            const filterByRoot = (items) => _.values(_.pick(items, rootNode.children));

            const cyNodeConfig = (node) => {
                const { id, type, pos, children, parent, title } = node;
                let selected, classes, data;

                if (type === 'vertex') {
                   selected = id in verticesSelectedById;
                   classes = mapVertexToClasses(id, vertices, focusing, registry['org.visallo.graph.node.class']);
                   data = mapVertexToData(id, vertices, registry['org.visallo.graph.node.transformer'], hovering);

                   if (data) {
                       renderedNodeIds[id] = true;
                   }
                } else {
                   const vertexIds = getVertexIdsFromCollapsedNode(collapsedNodes, id);
                   selected = vertexIds.some(id => id in verticesSelectedById)
                   classes = mapCollapsedNodeToClasses(id, collapsedNodes, focusing, vertexIds, registry['org.visallo.graph.collapsed.class']);
                   const nodeTitle = title || generateCollapsedNodeTitle(node, vertices, productVertices, collapsedNodes);
                   data = {
                       ...node,
                       vertexIds,
                       truncatedTitle: F.string.truncate(nodeTitle, 3),
                       imageSrc: this.state.collapsedImageDataUris[id] && this.state.collapsedImageDataUris[id].imageDataUri || 'img/loading-large@2x.png'
                   };
                   if (title) { data.title = title; }
                }

                return {
                    group: 'nodes',
                    data,
                    classes,
                    position: retina.pointsToPixels(pos),
                    selected,
                    grabbable: editable
                }
            }

            const renderedNodeIds = {};

            const cyVertices = filterByRoot(productVertices).reduce((nodes, nodeData) => {
                const { type, id, pos, parent } = nodeData;
                const cyNode = cyNodeConfig(nodeData);

                if (ghosts && id in ghosts) {
                    const ghostData = {
                        ...cyNode.data,
                        id: `${cyNode.data.id}-ANIMATING`,
                        animateTo: {
                            id: nodeData.id,
                            pos: { ...cyNode.position }
                        }
                    };
                    delete ghostData.parent;
                    nodes.push({
                        ...cyNode,
                        data: ghostData,
                        position: retina.pointsToPixels(ghosts[id]),
                        grabbable: false,
                        selectable: false
                    });
                }

                if (parent !== rootNode.id) {
                    return nodes;
                }

                if (id in vertices) {
                    const markedAsDeleted = vertices[id] === null;
                    if (markedAsDeleted) {
                        return nodes;
                    }
                    const vertex = vertices[id];
                    const applyDecorations = memoizeFor('org.visallo.graph.node.decoration#applyTo', vertex, () => {
                        return _.filter(registry['org.visallo.graph.node.decoration'], function(e) {
                            /**
                             * @callback org.visallo.graph.node.decoration~applyTo
                             * @param {object} vertex
                             * @returns {boolean} Whether the decoration should be
                             * added to the node representing the vertex
                             */
                            return !_.isFunction(e.applyTo) || e.applyTo(vertex);
                        });
                    });
                    if (applyDecorations.length) {
                        const parentId = 'decP' + id;
                        cyNode.data.parent = parentId;
                        const decorations = memoizeFor('org.visallo.graph.node.decoration#data', vertex, () => {
                            return applyDecorations.map(dec => {
                                const data = mapDecorationToData(dec, vertex, () => this.forceUpdate());
                                if (!data) {
                                    return;
                                }
                                var { padding } = dec;
                                return {
                                    group: 'nodes',
                                    classes: mapDecorationToClasses(dec, vertex),
                                    data: {
                                        ...data,
                                        id: idForDecoration(dec, vertex.id),
                                        alignment: dec.alignment,
                                        padding,
                                        parent: parentId,
                                        vertex
                                    },
                                    position: { x: -1, y: -1 },
                                    grabbable: false,
                                    selectable: false
                                }
                            })
                        });

                        nodes.push({
                            group: 'nodes',
                            data: { id: parentId },
                            classes: 'decorationParent',
                            selectable: false,
                            grabbable: false
                        });
                        nodes.push(cyNode);
                        decorations.forEach(d => {
                            if (d) nodes.push(d);
                        });
                    } else if (cyNode) {
                        nodes.push(cyNode);
                    }
                } else if (cyNode) {
                    nodes.push(cyNode);
                }

                return nodes
            }, []);

            _.defer(() => {
                CollapsedNodeImageHelpers.updateImageDataUrisForCollapsedNodes(
                    collapsedNodes,
                    vertices,
                    rootNode,
                    collapsedImageDataUris,
                    (newCollapsedImageDataUris) => {
                        this.setState({
                            collapsedImageDataUris: {
                                ...collapsedImageDataUris,
                                ...newCollapsedImageDataUris
                            }
                        });
                    }
                );
            });

            const cyCollapsedNodes = filterByRoot(collapsedNodes).reduce((nodes, nodeData) => {
                const { type, id, pos, parent, children } = nodeData;
                const cyNode = cyNodeConfig(nodeData);

                renderedNodeIds[id] = true;

                if (ghosts) {
                    _.mapObject(ghosts, ((ghost, ghostId) => {
                        if (cyNode.data.vertexIds.includes(ghostId)) {
                            const ghostData = {
                                ...mapVertexToData(ghostId, vertices, registry['org.visallo.graph.node.transformer'], hovering),
                                parent: rootNode.id,
                                id: `${ghostId}-ANIMATING`,
                                animateTo: {
                                    id: ghostId,
                                    pos: {...cyNode.position}
                                }
                            };

                            nodes.push({
                                ...cyNode,
                                data: ghostData,
                                classes: mapVertexToClasses(ghostId, vertices, focusing, registry['org.visallo.graph.node.class']),
                                position: retina.pointsToPixels(ghosts[id]),
                                grabbable: false,
                                selectable: false
                            });
                        }
                    }));
                }

                nodes.push(cyNode);
                return nodes;
            }, []);

            const cyNodes = cyVertices.concat(cyCollapsedNodes);

            const cyEdges = _.chain(productEdges)
                .filter(edgeInfo => {
                    const elementMarkedAsDeletedInStore =
                        edgeInfo.edgeId in edges &&
                        edges[edgeInfo.edgeId] === null;
                    return !elementMarkedAsDeletedInStore;
                })
                .groupBy(generateCompoundEdgeId)
                .map((edgeInfos, id) => {
                    const {inVertexId, outVertexId} = edgeInfos[0];
                    const edge = {
                        inNodeId: getRenderedNodeFromVertexId(inVertexId),
                        outNodeId: getRenderedNodeFromVertexId(outVertexId),
                        edgeInfos,
                        id
                    };
                    return edge;

                    function getRenderedNodeFromVertexId(vertexId) {
                        const vertex = productVertices[vertexId];
                        if (!vertex) return null;

                        let parentId = vertex.parent;
                        while (parentId !== rootNode.id && !(parentId in renderedNodeIds)) {
                            const parent = collapsedNodes[parentId];
                            if (!parent) return null;
                            parentId = parent.parent;
                        }
                        return parentId === rootNode.id ? vertexId : parentId;
                    }
                })
                .filter(({inNodeId, outNodeId}) => {
                    return inNodeId && outNodeId && (inNodeId !== outNodeId);
                })
                .groupBy(({ inNodeId, outNodeId }) => (inNodeId < outNodeId ? inNodeId + outNodeId : outNodeId + inNodeId))
                .reduce((edgeGroups, edgeGroup) => {
                    if (edgeGroup.length > MaxEdgesBetween) {
                        const { inNodeId, outNodeId } = edgeGroup[0];
                        const edgeInfos = edgeGroup.reduce((infos, group) => [...infos, ...group.edgeInfos], []);
                        const edgesForInfos = Object.values(_.pick(edges, _.pluck(edgeInfos, 'edgeId')));
                        const multiEdgeLabel = (edges) => {
                            const numTypes = _.size(_.groupBy(edgesForInfos, 'label'));
                            const display = edges[0] ?
                                edges[0].label in relationships ?
                                    relationships[edges[0].label].displayName : '' :
                                '';

                            return numTypes === 1 ?
                                i18n('org.visallo.web.product.graph.multi.edge.label.single.type', edges.length, display) :
                                i18n('org.visallo.web.product.graph.multi.edge.label', edges.length, numTypes);
                        }
                        let classes = 'e';
                        if (edgeInfos.some(({ edgeId }) => edgeId in focusing.edges)) {
                            classes += ' focusing';
                        }

                        const edgeData = {
                            data: {
                                id: inNodeId + outNodeId,
                                source: outNodeId,
                                target: inNodeId,
                                label: multiEdgeLabel(edgesForInfos),
                                edges: edgesForInfos,
                                edgeInfos,
                            },
                            classes,
                            selected: _.any(edgeInfos, e => e.edgeId in edgesSelectedById)
                        };
                        return [...edgeGroups, edgeData];
                    } else {
                        return [...edgeGroups, ...edgeGroup];
                    }
                }, [])
                .map(data => {
                    if (data.id) {
                        const edgesForInfos = Object.values(_.pick(edges, _.pluck(data.edgeInfos, 'edgeId')));
                        return {
                            data: mapEdgeToData(data, edgesForInfos, relationships, registry['org.visallo.graph.edge.transformer']),
                            classes: mapEdgeToClasses(data.edgeInfos, edgesForInfos, focusing, registry['org.visallo.graph.edge.class']),
                            selected: _.any(data.edgeInfos, e => e.edgeId in edgesSelectedById)
                        }
                    } else {
                        return data;
                    }
                })
                .value();

            return { nodes: cyNodes, edges: cyEdges };

        },

        resetQueuedSelection(sel) {
            this._queuedSelection = sel ? {
                add: { vertices: sel.vertices, edges: sel.edges },
                remove: {vertices: {}, edges: {}}
            } : { add: {vertices: {}, edges: {}}, remove: {vertices: {}, edges: {}} };

            if (!this._queuedSelectionTrigger) {
                this._queuedSelectionTrigger = _.debounce(() => {
                    const vertices = Object.keys(this._queuedSelection.add.vertices);
                    const edges = Object.keys(this._queuedSelection.add.edges);
                    if (vertices.length || edges.length) {
                        this.props.onSetSelection({ vertices, edges })
                    } else {
                        this.props.onClearSelection();
                    }
                }, 100);
            }
        },

        coalesceSelection(action, type, cyElementOrId) {
            if (!this._queuedSelection) {
                this.resetQueuedSelection();
            }
            let id = cyElementOrId;

            if (cyElementOrId && _.isFunction(cyElementOrId.data)) {
                if (type === 'compoundNode') {
                    cyElementOrId.data('vertexIds').forEach(vertexId => {
                        this.coalesceSelection(action, 'vertices', vertexId);
                    });
                    return;
                } else if (type === 'edges') {
                    cyElementOrId.data('edgeInfos').forEach(edgeInfo => {
                        this.coalesceSelection(action, type, edgeInfo.edgeId);
                    });
                    return;
                } else if (type === 'vertices') {
                    id = cyElementOrId.id();
                } else {
                    console.error(`Invalid type: ${type}`);
                    return;
                }
            }

            if (action !== 'clear') {
                this._queuedSelection[action][type][id] = id;
            }

            if (action === 'add') {
                delete this._queuedSelection.remove[type][id]
            } else if (action === 'remove') {
                delete this._queuedSelection.add[type][id]
            } else if (action === 'clear') {
                this._queuedSelection.add.vertices = {};
                this._queuedSelection.add.edges = {};
                this._queuedSelection.remove.vertices = {};
                this._queuedSelection.remove.edges = {};
            } else {
                console.warn('Unknown action: ', action)
            }

            this._queuedSelectionTrigger();
        },

        showConnectionPopover() {
            const cy = this.cytoscape.state.cy;
            const { connectionType, vertexId, toVertexId, connectionData } = this.state.draw;
            const Popover = Popovers(connectionType);
            Popover.teardownAll();
            Popover.attachTo(this.node, {
                cy,
                cyNode: cy.getElementById(toVertexId),
                otherCyNode: cy.getElementById(vertexId),
                edge: cy.$('edge.drawEdgeToMouse'),
                outVertexId: vertexId,
                inVertexId: toVertexId,
                connectionData
            });
        },

        legacyListeners(map) {
            this.removeEvents = [];

            _.each(map, (handler, events) => {
                var node = this.node;
                var func = handler;
                if (!_.isFunction(handler)) {
                    node = handler.node;
                    func = handler.handler;
                }
                this.removeEvents.push({ node, func, events });
                $(node).on(events, func);
            })
        }
    });

    const getVertexIdsFromCollapsedNode = (collapsedNodes, collapsedNodeId) => {
        const vertexIds = [];
        const queue = [collapsedNodes[collapsedNodeId]];

        while (queue.length > 0) {
            const collapsedNode = queue.pop();
            collapsedNode.children.forEach(id => {
                if (collapsedNodes[id]) {
                    queue.push(collapsedNodes[id])
                } else {
                    vertexIds.push(id);
                }
            });
        }

        return vertexIds;
    };

    const mapEdgeToData = (data, edges, ontologyRelationships, transformers) => {
        const { id, edgeInfos, outNodeId, inNodeId } = data;

        return memoizeFor('org.visallo.graph.edge.transformer', edges, () => {
            const { label } = edgeInfos[0];
            const base = {
                id,
                source: outNodeId,
                target: inNodeId,
                type: label,
                label: edgeDisplay(label, ontologyRelationships, edgeInfos),
                edgeInfos,
                edges
            };

            if (edges.length) {
                return transformers.reduce((data, fn) => {

                    /**
                     * Mutate the object to change the edge data.
                     *
                     * @callback org.visallo.graph.edge.transformer~transformerFn
                     * @param {object} data The cytoscape data object
                     * @param {string} data.source The source vertex id
                     * @param {string} data.target The target vertex id
                     * @param {string} data.type The edge label IRI
                     * @param {string} data.label The edge label display value
                     * @param {array.<object>} data.edgeInfos
                     * @param {array.<object>} data.edges
                     * @example
                     * function transformer(data) {
                     *     data.myCustomAttr = '';
                     * }
                     */
                    fn(data)
                    return data;
                }, base)
            }

            return base;
        }, () => id + outNodeId + inNodeId)
    };

    const mapEdgeToClasses = (edgeInfos, edges, focusing, classers) => {
        let cls = [];
        if (edges.length) {

            /**
             * Mutate the classes array to adjust the classes.
             *
             * @callback org.visallo.graph.edge.class~classFn
             * @param {array.<object>} edges List of edges that are collapsed into the drawn line. `length >= 1`.
             * @param {string} type EdgeLabel of the collapsed edges.
             * @param {array.<string>} classes List of classes that will be added to cytoscape edge.
             * @example
             * function(edges, type, cls) {
             *     cls.push('org-example-cls');
             * }
             */

            cls = memoizeFor('org.visallo.graph.edge.class', edges, function() {
                const cls = [];
                classers.forEach(fn => fn(edges, edgeInfos.label, cls));
                cls.push('e');
                return cls;
            }, () => edges.map(e => e.id).sort())
        } else {
            cls.push('partial')
        }

        const classes = cls.join(' ');

        if (_.any(edgeInfos, info => info.edgeId in focusing.edges)) {
            return classes + ' focus';
        }
        return classes;
    };

    const decorationIdMap = {};

    const decorationForId = id => {
        return decorationIdMap[id];
    };

    const idForDecoration = (function() {
        const decorationIdCache = new WeakMap();
        const vertexIdCache = {};
        var decorationIdCacheInc = 0, vertexIdCacheInc = 0;
        return (decoration, vertexId) => {
            var id = decorationIdCache.get(decoration);
            if (!id) {
                id = decorationIdCacheInc++;
                decorationIdCache.set(decoration, id);
            }
            var vId;
            if (vertexId in vertexIdCache) {
                vId = vertexIdCache[vertexId];
            } else {
                vId = vertexIdCacheInc++;
                vertexIdCache[vertexId] = vId;
            }
            var full = `dec${vId}-${id}`;
            decorationIdMap[full] = decoration;
            return full;
        }
    })();
    const mapDecorationToData = (decoration, vertex, update) => {
        const getData = () => {
            var data;
            /**
             * _**Note:** This will be called for every vertex change event
             * (`verticesUpdated`). Cache/memoize the result if possible._
             *
             * @callback org.visallo.graph.node.decoration~data
             * @param {object} vertex
             * @returns {object} The cytoscape data object for a decoration
             * given a vertex
             */
            if (_.isFunction(decoration.data)) {
                data = decoration.data(vertex);
            } else if (decoration.data) {
                data = decoration.data;
            }
            if (!_.isObject(data)) {
                throw new Error('data is not an object', data)
            }
            var p = Promise.resolve(data);
            p.catch(e => console.error(e))
            p.tap(() => {
                update()
            });
            return p;
        };
        const getIfFulfilled = p => {
            if (p.isFulfilled()) return p.value();
        }
        return getIfFulfilled(getData());
    };
    const mapDecorationToClasses = (decoration, vertex) => {
        var cls = ['decoration'];

        if (_.isString(decoration.classes)) {
            cls = cls.concat(decoration.classes.trim().split(/\s+/));
        } else if (_.isFunction(decoration.classes)) {

            /**
             * @callback org.visallo.graph.node.decoration~classes
             * @param {object} vertex
             * @returns {array.<string>|string} The classnames to add to the
             * node, either an array of classname strings, or space-separated
             * string
             */
            var newClasses = decoration.classes(vertex);
            if (!_.isArray(newClasses) && _.isString(newClasses)) {
                newClasses = newClasses.trim().split(/\s+/);
            }
            if (_.isArray(newClasses)) {
                cls = cls.concat(newClasses)
            }
        }
        return cls.join(' ');
    };

    const mapVertexToClasses = (id, vertices, focusing, classers) => {
        let cls = [];
        if (id in vertices) {
            const vertex = vertices[id];

            /**
             * Mutate the classes array to adjust the classes.
             *
             * @callback org.visallo.graph.node.class~classFn
             * @param {object} vertex The vertex that represents the node
             * @param {array.<string>} classes List of classes that will be added to cytoscape node.
             * @example
             * function(vertex, cls) {
             *     cls.push('org-example-cls');
             * }
             */
            cls = memoizeFor('org.visallo.graph.node.class', vertex, function() {
                const cls = [];
                classers.forEach(fn => fn(vertex, cls));
                cls.push('v');
                return cls;
            })
        } else {
            cls.push('partial')
        }

        const classes = cls.join(' ');
        if (id in focusing.vertices) {
            return classes + ' focus';
        }
        return classes;
    };

    const mapCollapsedNodeToClasses = (collapsedNodeId, collapsedNodes, focusing, vertexIds, classers) => {
        const cls = [];
        if (collapsedNodeId in collapsedNodes) {
            const collapsedNode = collapsedNodes[collapsedNodeId];

            /**
             * Mutate the classes array to adjust the classes.
             *
             * @callback org.visallo.graph.collapsed.class~classFn
             * @param {object} collapsedNode The collapsed item that represents the node
             * @param {array.<string>} classes List of classes that will be added to cytoscape node.
             * @example
             * function(collapsedNode, cls) {
             *     cls.push('org-example-cls');
             * }
             */
            classers.forEach(fn => fn(collapsedNode, cls));
            cls.push('c');

            if (vertexIds.some(vertexId => vertexId in focusing.vertices)) {
                cls.push('focus');
            }
        } else {
            cls.push('partial');
        }
        return cls.join(' ');
    };

    const getCyItemTypeAsString = (item) => {
        if (item.isNode()) {
            return item.data('vertexIds') ? 'compoundNode' : 'vertices';
        }
        return 'edges';
    };

    const generateCollapsedNodeTitle = (collapsedNode, vertices, productVertices, collapsedNodes) => {
        const children = _.chain(collapsedNode.children)
            .map(id => productVertices[id] || collapsedNodes[id])
            .compact()
            .reject(node => node.unauthorized || 'visible' in node && !node.visible)
            .value();
        const byType = _.groupBy(children, 'type');

        let title;
        if (vertices) {
            if (byType.vertex && byType.vertex.length > 1) {
                title = byType.vertex.map(({ id }) => (
                    vertices[id] ? F.vertex.title(vertices[id]) : ''
                )).join(', ');
            } else {
                title = i18n('org.visallo.web.product.graph.collapsedNode.entities.singular');
            }
        }

        return  title || i18n('org.visallo.web.product.graph.collapsedNode.entities', children.length);
    };

    const vertexToCyNode = (vertex, transformers, hovering) => {
        const title = F.vertex.title(vertex);
        const result = memoizeFor('vertexToCyNode', vertex, function() {
            const truncatedTitle = F.string.truncate(title, 3);
            const conceptType = F.vertex.prop(vertex, 'conceptType');
            const imageSrc = F.vertex.image(vertex, null, 150);
            const selectedImageSrc = F.vertex.selectedImage(vertex, null, 150);
            const startingData = {
                id: vertex.id,
                isTruncated: title !== truncatedTitle,
                truncatedTitle,
                conceptType,
                imageSrc,
                selectedImageSrc
            };

            return transformers.reduce((data, t) => {
                /**
                 * Mutate the data object that gets passed to Cytoscape.
                 *
                 * @callback org.visallo.graph.node.transformer~transformerFn
                 * @param {object} vertex The vertex representing this node
                 * @param {object} data The cytoscape data object
                 * @example
                 * function transformer(vertex, data) {
                 *     data.myCustomAttr = '...';
                 * }
                 */
                t(vertex, data)
                return data;
            }, startingData);
        });

        if (hovering === vertex.id) {
            return { ...result, truncatedTitle: title }
        }

        return result;
    }

    const mapVertexToData = (id, vertices, transformers, hovering) => {
        if (id in vertices) {
            if (vertices[id] === null) {
                return;
            } else {
                const vertex = vertices[id];
                return vertexToCyNode(vertex, transformers, hovering);
            }
        } else {
            return { id }
        }
    };

    const CONFIGURATION = (props) => {
        const { pixelRatio, uiPreferences, product, registry } = props;
        const { edgeLabels } = uiPreferences;
        const edgesCount = product.extendedData.edges.length;
        const styleExtensions = registry['org.visallo.graph.style'];

        return {
            minZoom: 1 / 16,
            maxZoom: 6,
            hideEdgesOnViewport: false,
            hideLabelsOnViewport: false,
            textureOnViewport: true,
            boxSelectionEnabled: true,
            panningEnabled: true,
            userPanningEnabled: true,
            zoomingEnabled: true,
            userZoomingEnabled: true,
            style: styles({ pixelRatio, edgesCount, edgeLabels, styleExtensions })
        }
    };

    return RegistryInjectorHOC(Graph, [
        'org.visallo.graph.edge.class',
        'org.visallo.graph.edge.transformer',
        'org.visallo.graph.export',
        'org.visallo.graph.node.class',
        'org.visallo.graph.node.decoration',
        'org.visallo.graph.node.transformer',
        'org.visallo.graph.collapsed.class',
        'org.visallo.graph.options',
        'org.visallo.graph.selection',
        'org.visallo.graph.style',
        'org.visallo.graph.view'
    ]);
});
