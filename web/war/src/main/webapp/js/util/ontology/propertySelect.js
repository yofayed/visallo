/**
 * Allows a user to select an ontology property from a searchable dropdown component.
 *
 * @module components/PropertySelect
 * @flight Dropdown selection component for selecting properties from the ontology
 * @attr {Array.<object>=} properties The ontology properties to populate the list with, if not provided will use visible properties
 * @attr {string} [placeholder=Select Property] the placeholder text to display
 * @attr {boolean} [limitParentConceptId=''] Only show properties that are attached to this concept or it's descendents
 * @attr {boolean} [onlySearchable=false] Only show properties that have searchable attribute equal to true in ontology
 * @attr {boolean} [onlySortable=false] Only show properties that have sortable attribute equal to true in ontology
 * @attr {boolean} [rollupCompound=true] Hide all dependant properties and only show the compound/parent fields
 * @attr {boolean} [focus=false] Activate the field for focus when finished rendering
 * @attr {string} [selectedProperty=''] Default the selection to this property IRI
 * @fires module:components/PropertySelect#propertyselected
 * @listens module:components/PropertySelect#filterProperties
 * @example
 * dataRequest('ontology', 'properties').then(function(properties) {
 *     PropertySelect.attachTo(node, {
 *         properties: properties
 *     })
 * })
 */
define([
    'flight/lib/component',
    'util/component/attacher'
], function(defineComponent, attacher) {


    var HIDE_PROPERTIES = ['http://visallo.org/comment#entry'];

    return defineComponent(PropertySelect);

    function PropertySelect() {
        this.after('teardown', function() {
            this.attacher.teardown();
        });

        this.after('initialize', function() {
            if ('unsupportedProperties' in this.attr) {
                console.warn('Attribute `unsupportedProperties` no longer used. Use filter attributes to customize list');
            }
            if ('maxItems' in this.attr) {
                console.warn('maxItems is no longer supported');
            }

            /**
             * Trigger to change the list of properties the component works with.
             *
             * @event module:components/PropertySelect#filterProperties
             * @property {object} data
             * @property {Array.<object>} data.properties The properties array to use
             * @example
             * PropertySelect.attachTo($node)
             * //...
             * $node.trigger('filterProperties', { properties: newList })
             */
            this.on('filterProperties', function(event, data) {
                if ('properties' in data) {
                    const params = this.attacher._params;
                    this.attacher.params({ ...params, filter: { ...params.filter, properties: _.indexBy(data.properties, 'title') }}).attach();
                }
            });

            const {
                filter = {},
                rollupCompound = true,
                focus,
                placeholder,
                properties,
                onlySearchable,
                onlySortable,
                showAdminConcepts,
                limitParentConceptId
            } = this.attr;

            if (onlySearchable === true) {
                filter.searchable = true;
            }
            if (showAdminConcepts === true) {
                filter.userVisible = undefined;
            }
            if (onlySortable === true) {
                filter.sortable = true
            }
            if (limitParentConceptId) {
                filter.conceptId = limitParentConceptId;
            }
            if (properties) {
                filter.properties = _.indexBy(properties, 'title');
            }

            this.attacher = attacher()
                .node(this.node)
                .params({
                    filter: { ...filter, rollupCompound },
                    value: this.attr.selectedProperty,
                    autofocus: focus === true,
                    placeholder
                })
                .behavior({
                    onSelected: (attacher, property) => {
                        /**
                         * When the user selects a property, this event will be
                         * triggered
                         *
                         * @event module:components/PropertySelect#propertyselected
                         * @property {object} data
                         * @property {object} data.property The property object that was selected
                         * @example
                         * $node.on('propertyselected', function(event, data) {
                         *     console.log(data.property)
                         * })
                         * PropertySelect.attachTo($node)
                         */
                        this.trigger('propertyselected', { property: property });
                    }
                })
                .path('components/ontology/PropertySelector');

            this.attacher.attach();
        });
    }
});
