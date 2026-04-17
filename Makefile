.PHONY: deploy deploy-split deploy-full up down logs

deploy:
	git pull
	docker compose up -d --build --remove-orphans

deploy-split:
	git pull
	docker compose -f docker-compose.yml -f docker-compose.split.yml up -d --build --remove-orphans

deploy-full:
	git pull
	docker compose -f docker-compose.yml -f docker-compose.db.yml up -d --build --remove-orphans

up:
	docker compose up -d --remove-orphans

down:
	docker compose down

logs:
	docker compose logs -f composure
