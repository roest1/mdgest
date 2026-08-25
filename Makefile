ROOT := $(shell cd $(dir $(lastword $(MAKEFILE_LIST))) && pwd)
UV   := uv

.PHONY: help setup test lint fmt check

help: ## list these targets
	@grep -hE '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/\t/' | sort | column -t -s "$$(printf '\t')"

setup: ## everything the targets below need
	cd $(ROOT)/engine && $(UV) sync --extra dev

test: ## the engine's tests
	cd $(ROOT)/engine && $(UV) run pytest -q

lint: ## ruff, plus the conventions this repo enforces
	cd $(ROOT)/engine && $(UV) run ruff check .
	cd $(ROOT)/engine && $(UV) run python ../scripts/prose_budget.py --check
	cd $(ROOT) && $(UV) run --project engine python scripts/check_language.py .

fmt: ## ruff --fix, then format
	cd $(ROOT)/engine && $(UV) run ruff check --fix . && $(UV) run ruff format .

check: test lint ## what CI runs
