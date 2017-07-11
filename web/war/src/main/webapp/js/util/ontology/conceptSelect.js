/**
 * Allows a user to select an ontology concept from a searchable dropdown component.
 *
 * @module components/ConceptSelect
 * @flight Dropdown selection component for selecting concepts from the ontology
 * @attr {string} [defaultText=Choose a Concept...] the placeholder text to display
 * @attr {boolean} [showAdminConcepts=false] Whether concepts that aren't user visible should be displayed
 * @attr {boolean} [onlySearchable=false] Only show concepts that have searchable attribute equal to true in ontology
 * @attr {string} [restrictConcept=''] Only allow selection of this concept or its descendants
 * @attr {string} [limitRelatedToConceptId=''] Only allow selection of concepts where there is a valid edge containing the passed in concept IRI
 * @attr {string} [selectedConceptId=''] Default the selection to this concept IRI
 * @attr {string} [selectedConceptIntent=''] Default the selection to this the first concept with this intent defined in ontology
 * @attr {boolean} [focus=false] Activate the field for focus when finished rendering
 * @attr {number} [maxItems=-1] Limit the maximum items that are shown in search list (-1 signifies no limit)
 * @fires module:components/ConceptSelect#conceptSelected
 * @listens module:components/ConceptSelect#clearSelectedConcept
 * @listens module:components/ConceptSelect#selectConceptId
 * @listens module:components/ConceptSelect#enableConcept
 * @example <caption>Use default component</caption>
 * ConceptSelect.attachTo(node)
 * @example <caption>Select a concept</caption>
 * ConceptSelect.attachTo(node, {
 *     selectedConceptId: 'http://www.visallo.org/minimal#person'
 * })
 */
define([
    'flight/lib/component',
    'util/component/attacher'
], function(defineComponent, attacher) {

    return defineComponent(ConceptSelector);

    function ConceptSelector() {
        this.after('teardown', function() {
            this.attacher.teardown();
        })

        this.after('initialize', function() {
            this.on('clearSelectedConcept', function(event) {
                this.attacher.params({ ...this.attacher._params, value: '' }).attach();
            })
            this.on('selectConceptId', function(event, { conceptId }) {
                this.attacher.params({ ...this.attacher._params, value: conceptId }).attach();
            })
            this.on('enableConcept', function(event, { disable, enable }) {
                const disabled = disable === true || enable === false
                this.attacher.params({ ...this.attacher._params, disabled }).attach();
            })

            const filter = {};
            if (this.attr.showAdminConcepts === true) {
                filter.userVisible = undefined;
            }
            if (this.attr.onlySearchable === true) {
                filter.searchable = true;
            }
            if (this.attr.restrictConcept) {
                filter.conceptId = this.attr.restrictConcept;
            }

            this.attacher = attacher()
                .node(this.node)
                .params({
                    filter,
                    value: this.attr.selectedConceptId,
                    placeholder: this.attr.defaultText,
                    autofocus: this.attr.focus === true
                })
                .behavior({
                    onSelected: (attacher, concept) => {
                        this.trigger('conceptSelected', { concept })
                    }
                })
                .path('components/ontology/ConceptSelector')

            this.attacher.attach();
        })
    }
});
