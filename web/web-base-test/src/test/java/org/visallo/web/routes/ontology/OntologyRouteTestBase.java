package org.visallo.web.routes.ontology;

import org.junit.Before;
import org.mockito.Mock;
import org.vertexium.Authorizations;
import org.visallo.core.config.Configuration;
import org.visallo.core.exception.VisalloException;
import org.visallo.core.model.lock.NonLockingLockRepository;
import org.visallo.core.model.ontology.Concept;
import org.visallo.core.model.ontology.OntologyPropertyDefinition;
import org.visallo.core.model.ontology.Relationship;
import org.visallo.core.model.user.InMemoryGraphAuthorizationRepository;
import org.visallo.core.model.user.PrivilegeRepository;
import org.visallo.core.security.VisalloVisibility;
import org.visallo.core.user.SystemUser;
import org.visallo.core.user.User;
import org.visallo.vertexium.model.ontology.VertexiumOntologyRepository;
import org.visallo.web.clientapi.model.PropertyType;
import org.visallo.web.routes.RouteTestBase;

import java.io.IOException;
import java.util.Collections;
import java.util.List;

import static org.visallo.core.model.user.UserRepository.USER_CONCEPT_IRI;

public abstract class OntologyRouteTestBase extends RouteTestBase {
    static final String WORKSPACE_ID = "junit-workspace";
    static final String PUBLIC_CONCEPT_IRI = "public-concept-a";
    static final String PUBLIC_CONCEPT_IRI_B = "public-concept-b";
    static final String PUBLIC_RELATIONSHIP_IRI = "public-relationship";
    static final String PUBLIC_RELATIONSHIP_IRI_B = "public-relationship-b";
    static final String PUBLIC_PROPERTY_IRI = "public-property";

    @Mock
    PrivilegeRepository privilegeRepository;

    Authorizations workspaceAuthorizations;

    @Before
    public void before() throws IOException {
        super.before();

        NonLockingLockRepository nonLockingLockRepository = new NonLockingLockRepository();
        InMemoryGraphAuthorizationRepository graphAuthorizationRepository = new InMemoryGraphAuthorizationRepository();
        try {
            ontologyRepository = new VertexiumOntologyRepository(graph, graphRepository, visibilityTranslator, configuration, graphAuthorizationRepository, nonLockingLockRepository) {
                @Override
                public void loadOntologies(Configuration config, Authorizations authorizations) throws Exception {
                    SystemUser systemUser = new SystemUser();
                    Concept rootConcept = getOrCreateConcept(null, ROOT_CONCEPT_IRI, "root", null, systemUser, null);
                    getOrCreateConcept(rootConcept, ENTITY_CONCEPT_IRI, "thing", null, systemUser, null);
                    getOrCreateConcept(null, USER_CONCEPT_IRI, "visalloUser", null, false, systemUser, null);
                    clearCache();
                }

                @Override
                protected PrivilegeRepository getPrivilegeRepository() {
                    return OntologyRouteTestBase.this.privilegeRepository;
                }
            };
        } catch (Exception e) {
            throw new VisalloException("Unable to create in memory ontology repository", e);
        }

        User systemUser = new SystemUser();
        Authorizations systemAuthorizations = graph.createAuthorizations(VisalloVisibility.SUPER_USER_VISIBILITY_STRING);
        Concept thingConcept = ontologyRepository.getEntityConcept(null);

        List<Concept> things = Collections.singletonList(thingConcept);
        Relationship hasEntityRel = ontologyRepository.getOrCreateRelationshipType(null, things, things, "has-entity-iri", true, systemUser, null);
        hasEntityRel.addIntent("entityHasImage", systemAuthorizations);

        ontologyRepository.getOrCreateConcept(thingConcept, PUBLIC_CONCEPT_IRI, "Public A", null, systemUser, null);
        ontologyRepository.getOrCreateConcept(thingConcept, PUBLIC_CONCEPT_IRI_B, "Public B", null, systemUser, null);
        ontologyRepository.getOrCreateRelationshipType(null, things, things, PUBLIC_RELATIONSHIP_IRI, true, systemUser, null);
        ontologyRepository.getOrCreateRelationshipType(null, things, things, PUBLIC_RELATIONSHIP_IRI_B, true, systemUser, null);

        OntologyPropertyDefinition ontologyPropertyDefinition = new OntologyPropertyDefinition(things, PUBLIC_PROPERTY_IRI, "Public Property", PropertyType.DATE);
        ontologyRepository.getOrCreateProperty(ontologyPropertyDefinition, systemUser, null);

        ontologyRepository.clearCache();

        workspaceAuthorizations = graph.createAuthorizations(WORKSPACE_ID);
    }
}
