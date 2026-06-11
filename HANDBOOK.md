# Indelible Overlay — Operator Handbook

A sovereign **SHIP/SLAP service-discovery node**. Services advertise *signed capability announcements*; agents look them up by topic. It's the **switchboard** of an open agent economy: it makes services *findable* without anyone owning the directory.

MIT-licensed. One dependency (`@bsv/sdk`). Generic — it hosts *any* topics, not just Indelible's. **Yours to run.**

> The node is an **untrusted directory.** It verifies on the way in, but trust is the *signature* (and an optional on-chain identity check), **never the node.** Every caller re-verifies. Run several; a node that hides an honest provider is overruled by one that serves it.

---

## What it does

| Verb | Who | What |
|---|---|---|
| `POST /submit` | a service | advertise a signed capability announcement |
| `POST /lookup` | an agent | "who offers topic X?" → the announcements (re-verify them yourself) |
| `GET /directory` | the dashboard | the whole directory (non-expired, non-revoked) |
| `GET /health` | anyone | node status (network, topics, providers) |

There is **no `/revoke` endpoint** — a published announcement is public, so a signature-only revoke would be replayable. Withdrawal rides **signed expiry** (let it lapse) and, on mainnet, the **on-chain revocation** registry.

---

## Quick start

```bash
git clone https://github.com/zcoolz/indelible-overlay
cd indelible-overlay
npm install
OVERLAY_NETWORK=testnet OVERLAY_PORT=8788 OVERLAY_CONFIG=./config.json node start.mjs
```

Open `http://localhost:8788/` in a browser — the node serves the dashboard there.

### Run the tests
```bash
npm test
```

---

## Configuration

Env vars: `OVERLAY_NETWORK` (`testnet`|`mainnet`), `OVERLAY_PORT`, `OVERLAY_CONFIG` (path to a JSON file).

`config.json`:
```json
{
  "network": "testnet",
  "port": 8788,
  "trustedProviders": ["02ab…", "03cd…"],
  "requireRegistryCheck": false,
  "maxPerTopic": 64,
  "maxTopics": 4096,
  "maxTtlMs": 604800000,
  "rateLimitPerMin": 60
}
```

| Key | Meaning |
|---|---|
| `network` | announcements whose signed `network` ≠ this are rejected |
| `trustedProviders` | **allowlist** of provider pubkeys permitted to `/submit` (use when the on-chain registry check is off) |
| `requireRegistryCheck` | mainnet: cross-check each provider against the on-chain identity registry (**fails closed** if unreachable) |
| `maxPerTopic` | cap per topic; at cap, **new** providers are refused (an established provider is never evicted) |
| `maxTtlMs` | reject announcements whose expiry is further out than this (no permanent ads → liveness) |
| `rateLimitPerMin` | per-IP `/submit` cap |

### ⚠️ Gate your node

With **no allowlist and no registry check**, the node runs in **OPEN mode** — any signed key may advertise (signature + rate-limit + cap still apply, but there's no identity binding). It logs a loud warning. For a real deployment:
- **Testnet / small federation:** set `trustedProviders`.
- **Mainnet:** set `requireRegistryCheck: true`.

---

## The trust model

1. Every announcement is **signed** by its `providerPubKey` (which is *inside* the signed payload — a forger can't swap it).
2. `/submit` admits only well-signed, in-network, unexpired announcements from an **allowlisted / registry-known** key.
3. `/lookup` returns the stored announcements; it **drops expired and revoked** ones — but the **caller re-verifies every signature**. The node is convenience, not authority.
4. **Federation = censorship resistance.** Query several nodes and union the results. No single node can hide a provider that another serves.

---

## The sovereign substrate

This node is one piece of a small open stack — **run any or all of it yourself:**

- **① Index** — what the chain holds (balances, UTXOs): [indelible-indexer](https://github.com/zcoolz/indelible-indexer)
- **② Proofs** — that a tx is really on-chain (portable Merkle proofs from your own node)
- **③ Overlay** — where services find each other (this node)
- **④ Bridge** — the **[Relay Federation Bridge](https://github.com/zcoolz/relay-federation)**, an **SPV node** (a bridge *is* an SPV node) that ties it together: it reads chain truth from the indexer *and* advertises its services on this overlay — the service layer your apps and agents actually talk to.

A floor everyone stands on, owned by no one.
