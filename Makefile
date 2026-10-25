.PHONY: help serve analyze graph clean-graphs deps deps-svg deps-engine deps-json deps-circular deps-summary deps-orphan deps-dynamic deps-check deps-clean

MADGE ?= npx madge

DEPS_EXTENSIONS ?= js,mjs
DEPS_EXCLUDE ?= (node_modules|outputs|snapshots)

DEPS_ROOT ?= .
DEPS_SVG ?= dependency-graph.svg

DEPS_ENGINE_ROOT ?= js
DEPS_ENGINE_SVG ?= dependency-graph-engine.svg

DEPS_JSON ?= dep.json
DEPS_LOG ?= madge.log

help:
	@echo "Commands:"
	@echo "  make serve             Serve browser app with npx serve"
	@echo ""
	@echo "Simulation exports:"
	@echo "  make analyze           Run analysis on newest am_run*.json export"
	@echo "  make analyze FILE=x    Run analysis on a specific export JSON"
	@echo "  make graph             Generate evidence graph from newest am_run*.json export"
	@echo "  make graph FILE=x      Generate evidence graph from a specific export JSON"
	@echo "  make clean-graphs      Remove generated evidence graph outputs"
	@echo ""
	@echo "Code dependency analysis:"
	@echo "  make deps              Generate full-project dependency SVG, alias for deps-svg"
	@echo "  make deps-svg          Generate full-project dependency graph SVG"
	@echo "  make deps-engine       Generate engine-only dependency SVG, js/ only, less noisy"
	@echo "  make deps-json         Generate machine-readable dependency JSON"
	@echo "  make deps-circular     Check for circular dependencies"
	@echo "  make deps-summary      Print module fan-out summary"
	@echo "  make deps-orphan       List production orphan candidates"
	@echo "  make deps-dynamic      Search for dynamic imports and requires"
	@echo "  make deps-check        Run circular check and orphan check"
	@echo "  make deps-clean        Remove generated dependency artifacts"

serve:
	npx serve

analyze:
	node scripts/analyze.js $(FILE)

graph:
	node scripts/graph/generateEvidenceGraph.js $(FILE)

clean-graphs:
	rm -rf outputs/graphs/*

deps: deps-svg

deps-svg:
	$(MADGE) --extensions $(DEPS_EXTENSIONS) --exclude "$(DEPS_EXCLUDE)" --image $(DEPS_SVG) $(DEPS_ROOT)

deps-engine:
	$(MADGE) --extensions $(DEPS_EXTENSIONS) --exclude "$(DEPS_EXCLUDE)" --image $(DEPS_ENGINE_SVG) $(DEPS_ENGINE_ROOT)

deps-json:
	$(MADGE) --extensions $(DEPS_EXTENSIONS) --exclude "$(DEPS_EXCLUDE)" --json $(DEPS_ROOT) > $(DEPS_JSON) 2>$(DEPS_LOG)

deps-circular:
	$(MADGE) --extensions $(DEPS_EXTENSIONS) --exclude "$(DEPS_EXCLUDE)" --circular $(DEPS_ROOT)

deps-summary:
	$(MADGE) --extensions $(DEPS_EXTENSIONS) --exclude "$(DEPS_EXCLUDE)" --summary $(DEPS_ROOT)

deps-orphan: deps-json
	node scripts/deps/orphans.cjs $(DEPS_JSON)

deps-dynamic:
	@grep -RniE 'import[(]|require[(]' js main.js scripts research tests 2>/dev/null || true

deps-check: deps-circular deps-orphan

deps-clean:
	rm -f $(DEPS_JSON) $(DEPS_LOG) $(DEPS_SVG) $(DEPS_ENGINE_SVG)