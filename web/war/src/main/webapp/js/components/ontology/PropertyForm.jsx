define([
    'create-react-class',
    'prop-types',
    './ConceptSelector',
    './RelationshipSelector',
    '../Alert'
], function(
    createReactClass,
    PropTypes,
    ConceptsSelector,
    RelationshipSelector,
    Alert) {

    const PropertyForm = createReactClass({
        propTypes: {
            transformForSubmit: PropTypes.func.isRequired,
            transformForInput: PropTypes.func.isRequired,
            onCreate: PropTypes.func.isRequired,
            onCancel: PropTypes.func.isRequired,
            displayName: PropTypes.string,
            domain: PropTypes.string,
            type: PropTypes.string
        },
        getInitialState() {
            return {};
        },
        getValue() {
            const { displayName } = this.state;
            const { displayName: defaultValue } = this.props;
            return _.isString(displayName) ? displayName : defaultValue;
        },
        componentDidMount() {
            const { domain, type } = this.props;
            this.setState({ domain, type })
        },
        componentWillReceiveProps(nextProps) {
            if (nextProps.domain !== this.state.domain) {
                this.setState({ domain: this.props.domain })
            }
            if (nextProps.type !== this.state.type) {
                this.setState({ type: nextProps.type })
            }
        },
        render() {
            const { domain, type } = this.state;
            const { conceptId, relationshipId, error, transformForSubmit, transformForInput } = this.props;
            const value = this.getValue();
            const valueForSubmit = transformForSubmit(value);
            const valueForInput = transformForInput(value);
            const disabled = _.isEmpty(valueForSubmit) || !type || !domain;
            return (
                <div className="selector-property-form">
                    { error ? (<Alert error={error} />) : null }
                    <input type="text"
                        onChange={this.onDisplayNameChange}
                        value={valueForInput} />

                    { relationshipId ?
                        (<RelationshipSelector
                            value={domain}
                            creatable={false}
                            clearable={false}
                            filter={{ relationshipId, showAncestors: true }}
                            onSelected={this.onDomainSelected} />) :
                        (<ConceptsSelector
                            value={domain}
                            creatable={false}
                            clearable={false}
                            filter={{ conceptId, showAncestors: true }}
                            onSelected={this.onDomainSelected} />)
                    }

                    <select value={type || ''} onChange={this.handleTypeChange}>
                        <option value="">Select Data Format…</option>
                        <optgroup label="Text">
                            <option value="string">String</option>
                            <option value="link">Link</option>
                        </optgroup>
                        <optgroup label="Numbers">
                            <option value="integer">Integer</option>
                            <option value="double">Double</option>
                            <option value="currency">Currency</option>
                            <option value="duration">Duration</option>
                            <option value="bytes">Size (Bytes)</option>
                        </optgroup>
                        <optgroup label="Dates">
                            <option value="dateOnly">Date</option>
                            <option value="datetime">Date (including time)</option>
                        </optgroup>
                        <optgroup label="Location">
                            <option value="geolocation">Geo Coordinate</option>
                        </optgroup>
                    </select>

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
        onDomainSelected(option) {
            this.setState({ domain: option ? option.title : null })
        },
        onDisplayNameChange(event) {
            this.setState({ displayName: event.target.value })
        },
        handleTypeChange(event) {
            this.setState({ type: event.target.value });
        },
        onCreate() {
            const domain = {};
            if (this.props.conceptId) {
                domain.conceptIris = [this.state.domain];
            }
            if (this.props.relationshipId) {
                domain.relationshipIris = [this.state.domain];
            }
            this.props.onCreate({
                domain: domain,
                type: this.state.type,
                displayName: this.getValue()
            })
        }
    });

    return PropertyForm;
});
