.PHONY: help serve analyze graph clean-graphs

help:
	@echo "Commands:"
	@echo "  make serve         Serve browser app with npx serve"
	@echo "  make analyze       Run analysis on newest am_run*.json export"
	@echo "  make analyze FILE=x Run analysis on a specific export JSON"
	@echo "  make graph         Generate graph from newest am_run*.json export"
	@echo "  make graph FILE=x  Generate graph from a specific export JSON"
	@echo "  make clean-graphs  Remove generated graph outputs"

serve:
	npx serve

analyze:
	node scripts/analyze.js $(FILE)

graph:
	node scripts/graph/generateEvidenceGraph.js $(FILE)

clean-graphs:
	rm -rf outputs/graphs/*