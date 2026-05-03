/*
 * If using this script for production, DO NOT FORGET to change
 * role passwords from <super_secret_password> to your own.
 */

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'composure_runtime') THEN
    CREATE ROLE composure_runtime LOGIN PASSWORD '<super_secret_password>' NOSUPERUSER NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'composure_migrator') THEN
    CREATE ROLE composure_migrator LOGIN PASSWORD '<super_secret_password>' NOSUPERUSER BYPASSRLS;
  END IF;
END
$$;

SELECT 'CREATE DATABASE composure_test'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'composure_test')\gexec

GRANT CONNECT ON DATABASE composure TO composure_runtime, composure_migrator;
GRANT CONNECT ON DATABASE composure_test TO composure_runtime, composure_migrator;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION composure_migrator;

GRANT USAGE ON SCHEMA public, app TO composure_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO composure_migrator;
GRANT USAGE, CREATE ON SCHEMA app TO composure_migrator;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO composure_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO composure_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO composure_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE composure_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO composure_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE composure_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO composure_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE composure_migrator IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO composure_runtime;