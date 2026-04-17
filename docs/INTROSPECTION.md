---
description: Keep introspection.md up to date with code changes
alwaysApply: true
---
# Introspection Maintenance
The file `repo-guide.md` at the repo `docs` folder documents this service's APIs, environment variables, dependencies, and data flows.
## When to Update
- When a new API endpoint is added or an existing one is modified
- When a new environment variable is added or an existing one is renamed
- When a new dependency is added (upstream service, library, external integration)
- When the data flow changes (new screens, new features, significant behavior changes)
- When deployment configuration changes
## How to Update
- Add new entries to the relevant section. Never delete existing entries unless
  the resource/endpoint has been completely removed from the codebase.
- For removed items, add a `(deprecated YYYY-MM-DD)` or `(removed YYYY-MM-DD)` marker.
- Keep the 10-section structure intact.
