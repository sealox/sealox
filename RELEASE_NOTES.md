# Sealos 0.8.1

## Highlights

- Refined the project, application, database, container, account, and chat interfaces with consistent spacing, typography, headers, actions, and compact detail layouts.
- Updated branding from Helios to Sealos and added the Sealos logo asset.
- Improved project topology controls and resource presentation, including cleaner canvas actions and status details.
- Improved container and database detail views with clearer network information, environment variable presentation, and direct conversation maintenance.
- Added project-aware chat creation and routing for resource maintenance conversations.
- Improved Codex runtime environment handling and proxy support for desktop conversations.
- Moved account logout into the account header and streamlined credential controls.
- Bumped workspace and desktop application versions to 0.8.1 (desktop build 9).

## Validation

- `git diff --check` passes.
- Backend/Eve test execution is currently blocked by the local Node 22.8.0 environment: TypeScript modules are loaded directly by Node, and the bundled `undici` build requires a newer Node WebIDL implementation. Use the repository's Node 24 toolchain for the full test suite.
