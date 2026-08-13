# eve Agent App

This project uses the eve framework. Before writing code, read the relevant guide
from the installed eve package docs. In most installs, those docs are at
`node_modules/eve/docs/`. In workspaces or local package installs, resolve the
installed `eve` package location first and read its `docs/` directory. If
package docs are unavailable, use https://eve.dev/docs as a fallback.

## Adding integrations

Before implementing an integration yourself, discover existing integrations:

```sh
eve registry search <query> --json
eve registry view <item>
```

Prefer registry items whose `implementation` is `native`; use Chat SDK adapters when no
native channel fits. `registry view` provides the selected item's documentation link.

Install and configure one without driving interactive terminal prompts:

```sh
eve add <item> --non-interactive
```

Exit code 0 means setup completed, 1 means setup failed, and 2 means setup needs
input or a prerequisite. On exit 2, parse the final NDJSON event and use its
`next.command` as the continuation.

Every `--answer` value is JSON, so strings need JSON quotes. For an editable
question, you may supply its nested `editable.key` with the parent key in one
invocation:

```sh
eve add channel/photon-imessage --non-interactive \
  --answer 'photon-project-source="create"' \
  --answer 'photon-project-name="eve · my-agent"'
```

Add `--yes` to accept recommended setup values and reduce setup round trips;
explicit `--answer` values take precedence. Use the reported `--skip-install`
continuation after installation.
A Vercel Connect setup may report `eve link` as a prerequisite; run it and
retry the continuation. Never pass secrets in `--answer`; use the documented
environment variable or secret store.

An `external_action` event with `blocking: true` means the command is still
running while it waits for the user. Surface its URL and code, keep the process
alive, and wait for its matching `external_action_resolved` event or a terminal
event. Do not start a continuation. When a completed event has
`deploymentRequired: true`, recommend its `next` command to deploy the changes.
