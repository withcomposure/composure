#!/usr/bin/env bash
# Usage: ./scripts/psql.sh "SQL here"

docker compose exec -T db psql -U postgres -d postgres -c "$1"