#!/bin/bash
set -e

# Create the sentinel user with the correct password
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER sentinel WITH PASSWORD 'sentinel123';
    ALTER USER sentinel CREATEDB;
    GRANT ALL PRIVILEGES ON DATABASE sentinel TO sentinel;
    GRANT ALL ON SCHEMA public TO sentinel;
EOSQL

echo "User 'sentinel' created successfully with password 'sentinel123'"