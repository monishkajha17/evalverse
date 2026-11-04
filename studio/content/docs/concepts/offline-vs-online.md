---
title: "Offline vs online evaluation"
description: "When to run a fixed suite before shipping, and when to sample live traces under a policy."
order: 16
group: Concepts
---

# Offline vs online evaluation

**Offline evaluation** means you run a fixed set of examples against each version of your agent, compare the results, and catch regressions before you ship.

**Online evaluation** means you send traces from a running agent. A **policy** picks which traces to check (a sample, or all) and which evaluators to run, and can raise an alert when a check fails.

```
Before ship                         After ship
───────────                         ──────────
cases.json ──► agent v1 / v2        live traffic ──► traces
      │                                    │
      ▼                                    ▼
 offline CLI / experiments              policy filter + sample
      │                                    │
      ▼                                    ▼
  compare table / UMS gate            evaluators + alerts
```

## When to use offline

- You are changing a prompt, model, or tool policy.
- You need comparable numbers across versions (same cases, same variants).
- You want blur / noise / blind controls in the suite.

Guide: [Offline experiments](/docs/guides/offline-cli/).

## When to use online

- The agent is in production or a shared demo.
- Failures are rare and you cannot wait for a full suite.
- You want continuous checks without blocking the request path (evaluators run asynchronously).

Guide: [Online evaluation and policies](/docs/guides/online-evaluation/).

## Shared pieces

Both paths use the same **trace** shape, the same **evaluators**, and the same result contract. Offline writes into suite JSON / experiments; online writes into the live database Studio reads in Live mode.

See the [glossary](/docs/concepts/glossary/) for term definitions.
