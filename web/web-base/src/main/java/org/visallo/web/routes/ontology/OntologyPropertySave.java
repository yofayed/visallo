package org.visallo.web.routes.ontology;

import com.google.inject.Inject;
import com.v5analytics.webster.annotations.Handle;
import com.v5analytics.webster.annotations.Optional;
import com.v5analytics.webster.annotations.Required;
import org.vertexium.TextIndexHint;
import org.visallo.core.exception.VisalloException;
import org.visallo.core.model.ontology.*;
import org.visallo.core.model.workQueue.WorkQueueRepository;
import org.visallo.core.user.User;
import org.visallo.web.clientapi.model.ClientApiOntology;
import org.visallo.web.clientapi.model.PropertyType;
import org.visallo.web.parameterProviders.ActiveWorkspaceId;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

public class OntologyPropertySave extends OntologyBase {
    private final OntologyRepository ontologyRepository;
    private final WorkQueueRepository workQueueRepository;

    @Inject
    public OntologyPropertySave(
            final OntologyRepository ontologyRepository,
            final WorkQueueRepository workQueueRepository
    ) {
        super(ontologyRepository);
        this.ontologyRepository = ontologyRepository;
        this.workQueueRepository = workQueueRepository;
    }

    @Handle
    public ClientApiOntology.Property handle(
            @Required(name = "displayName", allowEmpty = false) String displayName,
            @Required(name = "dataType", allowEmpty = false) String dataType,
            @Optional(name = "propertyIri", allowEmpty = false) String propertyIri,
            @Optional(name = "conceptIris[]") String[] conceptIris,
            @Optional(name = "relationshipIris[]") String[] relationshipIris,
            @ActiveWorkspaceId String workspaceId,
            User user) {

        List<Concept> concepts = ontologyIrisToConcepts(conceptIris, workspaceId);
        List<Relationship> relationships = ontologyIrisToRelationships(relationshipIris, workspaceId);

        PropertyType type = convertDataTypeStringToPropertyType(dataType);

        if (propertyIri == null) {
            propertyIri = ontologyRepository.generateDynamicIri(OntologyProperty.class, displayName, workspaceId, dataType);
        }

        OntologyProperty property = ontologyRepository.getPropertyByIRI(propertyIri, workspaceId);
        if (property == null) {
            OntologyPropertyDefinition def = new OntologyPropertyDefinition(concepts, relationships, propertyIri, displayName, type);
            def.setAddable(true);
            def.setDeleteable(true);
            def.setSearchable(true);
            def.setSortable(true);
            def.setUserVisible(true);
            def.setUpdateable(true);
            if (type.equals(PropertyType.STRING)) {
                def.setTextIndexHints(TextIndexHint.ALL);
            }

            property = ontologyRepository.getOrCreateProperty(def, user, workspaceId);
        } else {
            ontologyRepository.addPropertyToConcepts(property, concepts, user, workspaceId);
            ontologyRepository.addPropertyToRelationships(property, relationships, user, workspaceId);
        }

        ontologyRepository.clearCache(workspaceId);

        Iterable<String> conceptIds = concepts.stream().map(Concept::getId).collect(Collectors.toList());
        Iterable<String> relationshipIds = relationships.stream().map(Relationship::getId).collect(Collectors.toList());
        workQueueRepository.pushOntologyChange(workspaceId, conceptIds, relationshipIds, Collections.singletonList(property.getId()));

        return property.toClientApi();
    }

    private PropertyType convertDataTypeStringToPropertyType(String dataType) {
        boolean isValid = Arrays.stream(PropertyType.values())
                .anyMatch(pt -> pt.toString().toLowerCase().equals(dataType.toLowerCase()));
        if (!isValid) {
            throw new VisalloException("Unknown property type: " + dataType);
        }

        return PropertyType.valueOf(dataType.toUpperCase());
    }
}
