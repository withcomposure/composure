.PHONY: dev build deploy up down logs db-reset db-reset-test db-nuke test

dev:
	npm run dev

deploy:
	git pull
	docker compose up -d --build --remove-orphans

deploy-nodb:
	git pull
	docker compose -f docker-compose.nodb.yml up -d --build --remove-orphans

up:
	docker compose up -d --remove-orphans

down:
	docker compose down

logs:
	docker compose logs -f composure

db-reset:
	npm run db:reset

db-reset-test:
	npm run db:reset:test

db-nuke:
	npm run db:nuke

test:
	npm test

check:
	npm run check
