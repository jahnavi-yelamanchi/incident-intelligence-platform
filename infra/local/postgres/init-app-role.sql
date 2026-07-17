-- Local development credential only. Production creates an equivalent login
-- through infrastructure provisioning and stores its secret in Secrets Manager.
CREATE ROLE incident_app LOGIN PASSWORD 'incident_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
