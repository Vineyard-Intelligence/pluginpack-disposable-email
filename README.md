# Disposable Email

A Vineyard **plugin pack** that checks whether a selected email address belongs to a known
disposable-email domain, using the community-maintained blocklist
[`disposable/disposable-email-domains`](https://github.com/disposable/disposable-email-domains)
(74k+ domains, CC0).

One plugin:

- **Disposable Email Check** (`run.vineyard.plugins.disposable_email_check`) — selects an
  `identity.email_address` node, extracts the domain from its `email` value, and sets
  `data.is_disposable = true` (in the blocklist) or `false` (not in the blocklist) on that
  same node. Nothing is created; the check is a single `node:update`.

## How it works

- The blocklist is fetched from jsDelivr (`domains.json` variant) — jsDelivr serves
  `access-control-allow-origin: *`, so the browser can read it through an ordinary
  `ctx.net.fetch` with no desktop shell and no proxy.
- Matching is **exact domain or subdomain suffix**: a listed `mailinator.com` also flags
  `xyz.mailinator.com`, because disposable providers mint unlimited subdomains off one
  registered domain.
- Malformed addresses (no `@`, empty domain, whitespace) fail fast with a readable summary
  instead of a false negative.

## Layout

- `plugins/disposable-email.manifest.json` — the pack manifest (catalog entry source).
- `dist/pack.mjs` — the runnable bundle, compiled from
  `frontend/app/_views/projects/[id]/components-internal/plugins/reference/disposable-email-pack.ts`
  by `frontend/scripts/build-packs.mjs`.

Data: `disposable/disposable-email-domains` — <https://github.com/disposable/disposable-email-domains>
(CC0 / public domain).

## License

Apache-2.0
