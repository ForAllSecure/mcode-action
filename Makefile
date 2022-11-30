# Rebuild Javascript artifacts under the dist/ folder using a
# Dockerfile. After updating, don't forget to commit and push
# your changes.
.PHONY: dist-rebuild
dist-rebuild:
	docker build -t dist-builder .
	docker run -u $(shell id -u):$(shell id -g) --rm -v $(shell pwd):/out dist-builder cp -rv /workdir/dist/. /out/dist""
	docker rmi -f dist-builder