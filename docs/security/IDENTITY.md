# Identity and access

The production identity provider is Auth0. The application uses Auth0 Organizations and enterprise connections for tenant-aware SAML/OIDC federation, with MFA enforced by Auth0 policy and application authorization enforced by organization-scoped RBAC.

## Required token claims

- `sub`: immutable Auth0 subject identifier.
- `https://incident-intelligence.example/organization_id`: internal organization UUID mapped after login.
- `https://incident-intelligence.example/roles`: application roles issued by an Auth0 Action.

The API must derive tenant and role context from validated access-token claims. It must never accept an organization ID or role from an untrusted request header or body.

## Local development

When Auth0 variables are absent, the Next.js application permits a clearly marked local operator only while `NODE_ENV=development`. A production runtime with missing Auth0 configuration returns `503 identity_provider_unavailable`; it never activates the bypass.

## Auth0 application

Configure a Regular Web Application with callback `/auth/callback`, logout `/`, and web origin matching `APP_BASE_URL`. Configure an API audience matching `AUTH0_AUDIENCE`, enable refresh-token rotation, and add enterprise connections per customer organization. Secrets belong in AWS Secrets Manager and are injected into EKS workloads at runtime.
