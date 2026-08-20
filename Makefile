# mdgest — pdf -> markdown, with a UI and a CLI that do the same things.
#
#   make setup     install everything (uv for the engine, bun for the web app)
#   make dev       engine on :8770 + vite on :5173 (proxying /api)
#   make serve     build the web app and serve it from the engine on :8770
#   make add SRC=<pdf|zip|dir> [TO=<folder>]
#
#   make engine-bin     package the engine (PyInstaller -> src-tauri/binaries)
#   make desktop-dev    the desktop app against the vite dev server
#   make desktop-build  installable bundles (AppImage / deb / rpm / dmg / nsis)
#
# The workspace (sources/, markdown/, .mdgest/) defaults to ./workspace; set
# WS=... or MDGEST_WORKSPACE=... to point anywhere (a client's drive, say).
# The desktop app defaults to <app data>/workspace instead — same override.

SHELL := /bin/bash
ROOT  := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
WS    ?= $(ROOT)/workspace
PORT  ?= 8770
WEB_PORT ?= 5173
HOST  ?= 127.0.0.1

UV  := cd $(ROOT)/engine && MDGEST_WORKSPACE=$(WS) uv run
BUN := cd $(ROOT)/web && bun
MDGEST := $(UV) mdgest

export MDGEST_WORKSPACE := $(WS)

.DEFAULT_GOAL := help
.PHONY: help setup dev serve build api web add ls show md index test lint fmt typecheck check clean \
        engine-bin desktop-dev desktop-build

help: ## list these targets
	@echo "mdgest2 — make <target> [VAR=value]"; echo
	@grep -hE '^[a-z][a-zA-Z0-9_-]*:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo; echo "  WS=$(WS)  PORT=$(PORT)  WEB_PORT=$(WEB_PORT)"

setup: ## install the engine (uv) and the web app (bun)
	cd $(ROOT)/engine && uv sync --extra dev
	cd $(ROOT)/web && bun install

dev: ## run the engine and the vite dev server together (ctrl-c stops both)
	@trap 'kill 0' EXIT; \
	  ($(MDGEST) serve --host $(HOST) --port $(PORT)) & \
	  ($(BUN) run dev -- --host $(HOST) --port $(WEB_PORT)) & \
	  wait

api: ## run only the engine
	$(MDGEST) serve --host $(HOST) --port $(PORT)

web: ## run only the vite dev server (expects the engine on PORT)
	$(BUN) run dev -- --host $(HOST) --port $(WEB_PORT)

build: ## build the web app into web/dist (the engine serves it)
	$(BUN) run build

serve: build ## build the web app, then serve everything from the engine
	$(MDGEST) serve --host $(HOST) --port $(PORT)

# ---- the same things the UI does, from the shell -------------------------

add: ## add SRC (pdf | zip | directory) into TO: make add SRC=../kinesics-drive TO=kinesics
	@test -n "$(SRC)" || { echo "usage: make add SRC=<pdf|zip|dir> [TO=<folder>]"; exit 2; }
	$(MDGEST) add "$(abspath $(SRC))" --to "$(TO)"

ls: ## the explorer tree
	$(MDGEST) ls

show: ## numbered blocks of DOC (optionally PAGE=n)
	@test -n "$(DOC)" || { echo "usage: make show DOC=<id> [PAGE=n]"; exit 2; }
	$(MDGEST) show "$(DOC)" $(if $(PAGE),--page $(PAGE),)

md: ## print DOC's markdown
	@test -n "$(DOC)" || { echo "usage: make md DOC=<id>"; exit 2; }
	$(MDGEST) md "$(DOC)"

index: ## build INDEX.md over FOLDER (default: whole workspace)
	$(MDGEST) index "$(FOLDER)"

# ---- the desktop app -----------------------------------------------------

engine-bin: ## package the engine into src-tauri/binaries (PyInstaller)
	cd $(ROOT)/engine && uv run --extra build python $(ROOT)/scripts/build_engine.py

# (the tauri CLI only finds src-tauri when run from the repo root; the `tauri`
# script in web/package.json cds up while keeping node_modules/.bin on PATH)
desktop-dev: ## run the desktop app against the vite dev server
	@ls $(ROOT)/src-tauri/binaries/mdgest-engine-* >/dev/null 2>&1 || $(MAKE) engine-bin
	$(BUN) run tauri dev

desktop-build: engine-bin ## build the installable bundles for this OS
	$(BUN) run tauri build

# ---- working on mdgest ---------------------------------------------------

test: ## engine tests
	cd $(ROOT)/engine && uv run pytest -q

lint: ## ruff + tsc
	cd $(ROOT)/engine && uv run ruff check .
	$(BUN) run typecheck

typecheck: ## tsc only
	$(BUN) run typecheck

fmt: ## ruff format the engine
	cd $(ROOT)/engine && uv run ruff check --fix . && uv run ruff format .

check: test lint ## what CI would run

clean: ## remove build output and caches (never the workspace)
	rm -rf $(ROOT)/web/dist $(ROOT)/engine/.pytest_cache $(ROOT)/engine/.ruff_cache
