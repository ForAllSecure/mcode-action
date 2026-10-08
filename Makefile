.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help message.
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: dist-rebuild
dist-rebuild: ## Rebuild JavaScript artifacts under dist/ using a Dockerfile. Commit and push the result afterwards.
	docker build -t dist-builder .
	docker run -u $(shell id -u):$(shell id -g) --rm -v $(shell pwd):/out dist-builder cp -rv /workdir/dist/. /out/dist
	docker rmi -f dist-builder
