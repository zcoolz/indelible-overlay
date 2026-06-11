# 📡 Indelible Overlay

**Sovereign service discovery for BSV agents — find each other on a directory no one owns.**

![license](https://img.shields.io/badge/license-MIT-black) ![node](https://img.shields.io/badge/node-%E2%89%A518-orange) ![chain](https://img.shields.io/badge/chain-BSV-amber)

> *Advertise · discover · re-verify. A floor everyone stands on, owned by no one.*

---

A market needs a meeting ground. Most discovery runs through someone else's index — and inherits its outages, its gatekeeping, its version of "who's out there." **Indelible Overlay removes the middleman.** It's a tiny, dependency-light directory you run yourself: services **advertise** signed capability announcements, agents **look them up** by topic, and **every caller re-verifies** — the node is convenience, never authority.

It carries zero application code — generic infrastructure. Run one beside your services so others can find them; run several and no single node can hide an honest provider.

### How it works
- 📣 **Advertise.** A service posts a **signed capability announcement** — what it offers, where, at what price — signed by its own key. The signature *is* the trust; the provider's pubkey is inside the signed payload, so a forger can't swap it.
- 🔎 **Discover.** An agent asks "who offers topic X?" and gets the announcements back — then **re-verifies every signature itself**.
- 🛡️ **Untrusted by design.** The directory can't forge, and it can't hide a provider that another node serves. Query several nodes, union the results — the federation *is* the censorship resistance.

## ⚡ Quick start
```bash
git clone https://github.com/zcoolz/indelible-overlay.git
cd indelible-overlay && npm install

# gate it first (see the Handbook): allowlist on testnet, registry on mainnet
OVERLAY_NETWORK=testnet OVERLAY_PORT=8788 OVERLAY_CONFIG=./config.json node start.mjs
```
Then open **`http://localhost:8788/`** in a browser — the node serves a live dashboard of the directory (same as the indexer's).

> ⚠️ With **no allowlist and no registry check**, the node runs **OPEN** — any signed key may advertise (signature + rate-limit + per-topic cap still apply). Set `trustedProviders` (testnet) or `requireRegistryCheck` (mainnet). Full setup → **[Operator Handbook](./HANDBOOK.md)**.

## 🧩 API at a glance
| Method · path | Purpose |
|---|---|
| `POST /submit` | advertise a signed capability announcement |
| `POST /lookup` | `{service, query:{topic}}` → the announcements for a topic (re-verify them) |
| `GET /directory` | the whole directory — powers the dashboard |
| `GET /health` | node + directory status |

There is **no `/revoke` endpoint** — a published announcement is public, so a signature-only revoke would be replayable. Withdrawal rides **signed expiry** (let it lapse) + on-chain revocation.

## 🔎 Don't trust, verify
A lookup returns `{announcement, signature}` pairs. The trust is the **signature** plus an optional on-chain identity check — never the node, which only stores and serves. **You verify.** And because it's a *federation*, you query several nodes and union the results: a node that censors an honest provider is simply overruled by one that serves it.

## 🏛️ How it fits
```
   service · bridge · agent        (advertises / discovers)
              │  HTTP
        ┌─────▼─────────┐
        │   Indelible   │        ← this repo  (HTTP :8788)
        │    Overlay    │
        └───────────────┘
        run one, or many — a federation no single hand controls
```
The overlay is one of three small, independent pieces you can run sovereignly:
- **indelible-indexer** — chain truth + inclusion proofs *(separate repo)*.
- **indelible-overlay** — this repo (service discovery).
- a federation **bridge** — the service layer your apps talk to.

Own the node · own the index · own the **directory**.

## 📄 License
[MIT](./LICENSE) — run it, fork it, ship it. Built by the **Indelible Federation**.
