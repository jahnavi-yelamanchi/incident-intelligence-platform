-- Webhook delivery has no authenticated user context. This narrowly scoped
-- SECURITY DEFINER function resolves a random connection ID to its tenant and
-- encrypted secret without exposing a cross-tenant table scan to the app role.
CREATE FUNCTION resolve_integration_connection(p_connection_id uuid, p_provider "IntegrationProvider")
RETURNS TABLE (organization_id uuid, encrypted_credentials text, status "IntegrationStatus")
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT organization_id, encrypted_credentials, status
  FROM integration_connections
  WHERE id = p_connection_id AND provider = p_provider
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION resolve_integration_connection(uuid, "IntegrationProvider") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_integration_connection(uuid, "IntegrationProvider") TO incident_app;
