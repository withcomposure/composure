DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'composure_app') THEN
    CREATE ROLE composure_app LOGIN PASSWORD 'composure_app' NOSUPERUSER NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'composure_migrator') THEN
    CREATE ROLE composure_migrator LOGIN PASSWORD 'composure_migrator' NOSUPERUSER BYPASSRLS;
  END IF;
END
$$;

SELECT 'CREATE DATABASE composure_test'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'composure_test')\gexec

GRANT CONNECT ON DATABASE composure TO composure_app, composure_migrator;
GRANT CONNECT ON DATABASE composure_test TO composure_app, composure_migrator;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION composure_migrator;

GRANT USAGE ON SCHEMA public, app TO composure_app;
GRANT USAGE, CREATE ON SCHEMA public TO composure_migrator;
GRANT USAGE, CREATE ON SCHEMA app TO composure_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE composure_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO composure_app;
ALTER DEFAULT PRIVILEGES FOR ROLE composure_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO composure_app;
ALTER DEFAULT PRIVILEGES FOR ROLE composure_migrator IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO composure_app;