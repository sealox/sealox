# Sealos 0.8.2

## Highlights

- Unified Codex App Server and local Codex model selection, defaulting to `gpt-5.6-sol` for the current account configuration.
- Added automatic Eve model fallback when an enabled model is exhausted or rate limited.
- Corrected macOS traffic-light alignment with the sidebar toggle and verified the built desktop app visually.

## Validation

- Flutter Analyze passes.
- Desktop backend typecheck and build pass.
- Eve typecheck and all 7 tests pass.
- macOS Debug build and runtime screenshot verification pass.

---

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
