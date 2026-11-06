// Disposable Email pack — checks whether a selected email address's domain is a
// known disposable-email domain, using the community-maintained blocklist at
// github.com/disposable/disposable-email-domains.
//
// The blocklist ships as both domains.json (a JSON array) and domains.txt (newline
// separated); we fetch the JSON variant from jsDelivr because it parses in one line
// and jsDelivr serves `access-control-allow-origin: *`, so the browser can read it
// directly through an ordinary `ctx.net.fetch` — no desktop shell needed.
//
// Matching is by exact domain OR subdomain suffix: `mailinator.com` in the list must
// also flag `xyz.mailinator.com`, since disposable providers mint unlimited
// subdomains off one registered domain (see the catch-all / subdomain discussion in
// the pack README).
//
// The result is written back onto the node itself (`data.is_disposable`), so the
// plugin needs only node:read + node:update — it creates nothing.
import { definePlugin } from './sdk';
import type { HostContext, RunResult, GraphNode } from './sdk';

// jsDelivr mirror of disposable/disposable-email-domains@master/domains.json.
// `@master` tracks the live list (edge-cached); pin to a commit SHA for a
// reproducible snapshot instead.
const BLOCKLIST_URL = 'https://cdn.jsdelivr.net/gh/disposable/disposable-email-domains@master/domains.json';

/** Extract the domain part of an email address. Null if malformed. */
function domainOf(email: string): string | null {
    const at = email.indexOf('@');
    if (at <= 0 || at === email.length - 1) return null;
    const domain = email
        .slice(at + 1)
        .toLowerCase()
        .trim();
    if (!domain || domain.includes(' ')) return null;
    return domain;
}

/** True if `domain` is in the blocklist, or is a subdomain of a blocklisted domain. */
function isDisposableDomain(domain: string, blocklist: Set<string>): boolean {
    if (blocklist.has(domain)) return true;
    // Subdomain suffix match: xyz.mailinator.com -> check mailinator.com, then
    // mailinator.com's parents, walking up label by label.
    let idx = domain.indexOf('.');
    while (idx !== -1) {
        const parent = domain.slice(idx + 1);
        if (blocklist.has(parent)) return true;
        idx = domain.indexOf('.', idx + 1);
    }
    return false;
}

export default definePlugin({
    manifest: {
        identifier: 'run.vineyard.plugins.disposable_email',
        content_type: 'vineyard:plugin',
        name: 'Disposable Email Check',
        version: '1.1.3',
        description:
            "Checks each selected Email Address's domain, including its parent domains, against the disposable-email-domains blocklist and sets is_disposable (true/false) on the node. Creates no nodes.",
        icon: 'mail-x',
        author: { name: 'VINEYARD', url: 'https://vineyard.run' },
        license: 'Apache-2.0',
        platforms: {
            primary: 'web',
            web: { runtime: 'sandbox-js', entry: 'dist/pack.mjs' },
            desktop: { runtime: 'sandbox-js', entry: 'dist/pack.mjs' },
        },
        io: {
            consumes: [{ typepack: 'run.vineyard.typepacks.identity', category: 'identity', name: 'email_address' }],
            produces: [],
        },
        scopes: {
            graph: ['node:read', 'node:update'],
            network: [
                {
                    endpoint: BLOCKLIST_URL,
                    methods: ['GET'],
                    purpose: 'Fetch the disposable-email-domains blocklist.',
                },
            ],
        },
        lifecycle: { persistence: 'opt-in', controls: ['progress', 'cancel'], progress: 'determinate' },
    },

    async run(ctx: HostContext): Promise<RunResult> {
        const ids = ctx.input.selection;
        if (!ids.length) {
            return { summary: 'Select an Email Address node first', counts: { checked: 0 } };
        }

        // Fetched ONCE for the whole selection, not once per node: the blocklist does not depend
        // on which node is being checked, and 16 nodes making 16 identical requests would be 16x
        // the cost for the same answer every time.
        ctx.progress?.set?.({ percent: 5, message: 'Fetching the disposable-email blocklist…' });
        const res = await ctx.net!.fetch!(BLOCKLIST_URL, { method: 'GET' });
        if (!res.ok) {
            return { summary: `Blocklist fetch failed: HTTP ${res.status}`, counts: { checked: 0 } };
        }
        let list: unknown;
        try {
            list = await res.json();
        } catch {
            return { summary: 'Blocklist response was not JSON', counts: { checked: 0 } };
        }
        if (!Array.isArray(list)) {
            return { summary: 'Blocklist response was not an array', counts: { checked: 0 } };
        }
        const blocklist = new Set<string>(
            list.filter((d): d is string => typeof d === 'string').map((d) => d.toLowerCase()),
        );

        let checked = 0;
        let disposable = 0;
        let notFound = 0;
        let noEmail = 0;
        let lastDomain = '';
        for (let i = 0; i < ids.length; i++) {
            if (ctx.signal?.aborted) {
                return {
                    summary: `Cancelled after ${checked}/${ids.length} address(es)`,
                    counts: { checked, disposable, not_found: notFound, no_email: noEmail },
                };
            }
            const seed: GraphNode | null = await ctx.graph!.get!(ids[i]);
            if (!seed) {
                notFound++;
                continue;
            }
            const email = typeof seed.data?.email === 'string' ? seed.data.email : '';
            const domain = domainOf(email);
            if (!domain) {
                noEmail++;
                continue;
            }

            const isDisposable = isDisposableDomain(domain, blocklist);
            // `data` here is the patch object merged at the node's data TOP LEVEL — the same level
            // as `email`, `domain`, `breached` — so is_disposable lands as data.is_disposable.
            // (Wrapping it as { data: {...} } would create a nested data.data object that the
            // server stringifies as "[Object Object]".)
            await ctx.graph!.updateNode!(String(seed.id), { is_disposable: isDisposable });
            checked++;
            if (isDisposable) disposable++;
            lastDomain = domain;

            ctx.progress?.set?.({
                percent: 5 + Math.round((95 * (i + 1)) / ids.length),
                message: `${checked}/${ids.length} checked · ${disposable} disposable`,
            });
        }

        const skipped = notFound + noEmail;
        const skipNote = skipped
            ? ` (${skipped} skipped: ${noEmail} without a valid email, ${notFound} not found)`
            : '';
        return {
            summary:
                checked === 1
                    ? disposable
                        ? `${lastDomain} is a known disposable-email domain`
                        : `${lastDomain} is not in the disposable-email blocklist`
                    : `${checked} address(es) checked, ${disposable} disposable${skipNote}`,
            counts: { checked, disposable, not_found: notFound, no_email: noEmail },
        };
    },
});
