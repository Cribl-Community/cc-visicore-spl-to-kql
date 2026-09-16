# Regenerating src/data/kql-catalog.ts

The catalog is a snapshot of `GET /api/v1/m/default_search/search/docs` (the Kusto docs
bundle that powers Cribl Search autocomplete). To refresh it, fetch that endpoint as JSON
and run the generator embedded in the project history (see AGENTS.md → "Catalog").
The app also fetches the live bundle at runtime for the Reference panel, so the snapshot
only needs to be refreshed when the offline (dev) reference drifts.
