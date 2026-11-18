import { identityRef } from '../src/auth/identityIds.js';
import type { ApplicationId, DeploymentId, OAuthClientId, IdentityRef } from '../src/auth/identityIds.js';

const app: ApplicationId = identityRef('application', 'aiko').id;
const deployment: DeploymentId = identityRef('deployment', 'deploy-1').id;
const client: OAuthClientId = identityRef('oauth_client', 'client-1').id;
const appRef: IdentityRef<'application'> = identityRef('application', app);
void [deployment, client, appRef];
// @ts-expect-error Deployment IDs must not be passed as application IDs.
const wrongApp: ApplicationId = deployment;
// @ts-expect-error OAuth clients are not deployment IDs.
const wrongDeployment: DeploymentId = client;
// @ts-expect-error A deployment reference cannot be used as an app reference.
const wrongRef: IdentityRef<'application'> = identityRef('deployment', deployment);
void [wrongApp, wrongDeployment, wrongRef];
