-- Application traffic must never connect as the database owner. PostgreSQL
-- superusers bypass row-level security, including FORCE ROW LEVEL SECURITY.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'incident_app') THEN
        CREATE ROLE incident_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE incident TO incident_app;
GRANT USAGE ON SCHEMA public TO incident_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO incident_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_events FROM incident_app;
GRANT SELECT, INSERT ON TABLE audit_events TO incident_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO incident_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO incident_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO incident_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO incident_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO incident_app;
