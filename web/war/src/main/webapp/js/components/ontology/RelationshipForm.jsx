define([
    'create-react-class',
    'prop-types',
    './ConceptSelector',
    '../Alert'
], function(createReactClass, PropTypes, ConceptsSelector, Alert) {

    const RelationshipForm = createReactClass({
        propTypes: {
            transformForSubmit: PropTypes.func.isRequired,
            transformForInput: PropTypes.func.isRequired,
            onCreate: PropTypes.func.isRequired,
            onCancel: PropTypes.func.isRequired,
            displayName: PropTypes.string
        },
        getInitialState() {
            return {}
        },
        getValue() {
            const { displayName } = this.state;
            const { displayName: defaultValue } = this.props;
            return _.isString(displayName) ? displayName : defaultValue;
        },
        render() {
            const { error, transformForSubmit, transformForInput } = this.props;

            const value = this.getValue();
            const valueForSubmit = transformForSubmit(value);
            const valueForInput = transformForInput(value);
            const disabled = _.isEmpty(valueForSubmit);
            return (
                <div>
                    { error ? (<Alert error={error} />) : null }
                    <ConceptsSelector
                        value={_.isString(this.state.sourceId) ? this.state.sourceId : this.props.sourceId}
                        placeholder="From Concept"
                        filter={{conceptId: this.props.sourceId, showAncestors: true }}
                        creatable={false}
                        clearable={false}
                        onSelected={this.onSourceConceptSelected} />

                    <input type="text"
                        placeholder="Display Name"
                        onChange={this.onDisplayNameChange}
                        value={valueForInput} />

                    <ConceptsSelector
                        value={_.isString(this.state.targetId) ? this.state.targetId : this.props.targetId}
                        filter={{conceptId: this.props.targetId, showAncestors: true }}
                        placeholder="To Concept"
                        clearable={false}
                        creatable={false}
                        onSelected={this.onTargetConceptSelected} />

                    <div className="base-select-form-buttons">
                    <button
                        onClick={this.props.onCancel}
                        className="btn btn-link btn-small"
                        style={{ width: 'auto', marginBottom: '1em'}}>Cancel</button>
                    <button
                        disabled={disabled}
                        onClick={this.onCreate}
                        className="btn btn-small btn-primary"
                        style={{ width: 'auto', marginBottom: '1em'}}>{
                            disabled ? 'Create' : `Create "${valueForSubmit}"`
                        }</button>
                    </div>
                </div>
            )
        },
        onDisplayNameChange(event) {
            this.setState({ displayName: event.target.value });
        },
        onSourceConceptSelected(concept) {
            this.setState({ sourceId: concept.id })
        },
        onTargetConceptSelected(concept) {
            this.setState({ targetId: concept.id })
        },
        onCreate() {
            this.props.onCreate({
                sourceIris: [this.state.sourceId || this.props.sourceId],
                targetIris: [this.state.targetId || this.props.targetId],
                displayName: this.getValue()
            })
        }
    });

    return RelationshipForm;
});

