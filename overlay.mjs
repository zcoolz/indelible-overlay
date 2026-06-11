// overlay.mjs — the Indelible Overlay Node (g-288). A sovereign SHIP/SLAP directory:
// services SUBMIT signed capability announcements; agents LOOK UP providers by topic.
// MIT, @bsv/sdk only. Generic (topic-agnostic core); Indelible ships as config.
//
// Trust = the SIGNATURE + an identity gate (g-240 registry on mainnet / a pubkey
// allowlist otherwise), NEVER the node itself — every caller re-verifies. A single
// node can't forge (sig) and can't hide a provider another node serves (federate the
// lookup). [g-288-overlay-node-design.md]
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyAnnouncement, isExpired } from './verify.mjs'
import { DirectoryStore } from './store.mjs'

// Dashboard (zero-dep HTML served at GET /, like the indexer). Loaded once at boot;
// a missing file just means no dashboard — the API is unaffected.
const __dirname = dirname(fileURLToPath(import.meta.url))
let DASHBOARD = ''
try { DASHBOARD = readFileSync(join(__dirname, 'dashboard.html'), 'utf8') } catch { /* dashboard optional */ }

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body)) }

async function readBody (req, maxBytes = 256 * 1024) {
  const chunks = []
  let len = 0
  for await (const c of req) {
    len += c.length
    if (len > maxBytes) { try { req.destroy() } catch {}; throw new Error('body too large') }
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createOverlayNode (config = {}) {
  const network = config.network || 'testnet'
  const store = new DirectoryStore({ maxPerTopic: config.maxPerTopic, maxTopics: config.maxTopics })
  const trusted = Array.isArray(config.trustedProviders) && config.trustedProviders.length ? new Set(config.trustedProviders) : null
  const registryCheck = typeof config.registryCheck === 'function' ? config.registryCheck : null   // g-240 hook
  const isRevoked = typeof config.isRevoked === 'function' ? config.isRevoked : null               // g-240 revocation hook
  const requireRegistryCheck = !!config.requireRegistryCheck
  const RL_MAX = config.rateLimitPerMin || 60
  const maxTtlMs = config.maxTtlMs ?? 7 * 24 * 60 * 60 * 1000   // [diff #4] cap TTL — no permanent announcements; forces periodic re-advertising = liveness

  // per-IP, per-minute rate limit [pack #1]
  const rl = new Map()
  const rateOk = (ip, now) => {
    const w = Math.floor(now / 60000)
    const k = ip + ':' + w
    const n = (rl.get(k) || 0) + 1
    rl.set(k, n)
    if (rl.size > 5000) for (const key of [...rl.keys()]) { if (!key.endsWith(':' + w)) rl.delete(key) }
    return n <= RL_MAX
  }

  // identity gate [pack #1/#5]: registry (mainnet, FAIL-CLOSED) → allowlist → open(warned)
  const admitIdentity = async (pub) => {
    if (requireRegistryCheck && registryCheck) {
      try { return (await registryCheck(pub)) ? { ok: true } : { ok: false, reason: 'provider not in registry', status: 403 } }
      catch { return { ok: false, reason: 'registry unavailable', status: 503 } }   // FAIL-CLOSED [pack #5]
    }
    if (trusted) return trusted.has(pub) ? { ok: true } : { ok: false, reason: 'provider not allowlisted', status: 403 }   // [pack #1]
    return { ok: true }   // open mode — start.mjs warns loudly
  }

  const handler = async (req, res) => {
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0].trim()
    const url = new URL(req.url, 'http://localhost')
    const now = Date.now()
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        if (DASHBOARD) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(DASHBOARD); return }
        return json(res, 200, { ok: true, service: 'indelible-overlay', network, ...store.stats() })   // no dashboard.html → JSON fallback
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { ok: true, service: 'indelible-overlay', network, ...store.stats() })
      }
      if (req.method === 'GET' && url.pathname === '/directory') {   // dashboard data source
        return json(res, 200, { service: 'indelible-overlay', network, ...store.stats(), topics: store.directory(now, isRevoked) })
      }

      if (req.method === 'POST' && url.pathname === '/submit') {
        if (!rateOk(ip, now)) return json(res, 429, { error: 'rate limited' })
        let payload
        try { payload = JSON.parse(await readBody(req) || '{}') } catch { return json(res, 400, { error: 'invalid JSON' }) }
        const { announcement, signature } = payload || {}
        if (!verifyAnnouncement({ announcement, signature })) return json(res, 400, { error: 'invalid signature' })
        if (announcement.network !== network) return json(res, 400, { error: 'network mismatch' })   // [pack #4]
        if (isExpired(announcement, now)) return json(res, 400, { error: 'expired' })                 // [pack #2]
        if (Date.parse(announcement.expiresAt) - now > maxTtlMs) return json(res, 400, { error: 'ttl too long' })   // [diff #4]
        const id = await admitIdentity(announcement.providerPubKey)
        if (!id.ok) return json(res, id.status, { error: id.reason })
        const r = store.put({ announcement, signature }, now)
        if (!r.stored) return json(res, 400, { error: r.error || 'not stored' })
        return json(res, 200, { ok: true, topics: r.topics })
      }

      if (req.method === 'POST' && url.pathname === '/lookup') {
        let q
        try { q = JSON.parse(await readBody(req) || '{}') } catch { return json(res, 400, { error: 'invalid JSON' }) }
        const topic = q?.query?.topic
        if (typeof topic !== 'string' || !topic) return json(res, 400, { error: 'query.topic required' })
        const announcements = store.lookup(topic, now, isRevoked)
        return json(res, 200, { type: 'announcement-list', topic, announcements })   // honest shape — NOT a fake BEEF output-list
      }

      // NB: no HTTP /revoke [diff #1] — a published {announcement, signature} is PUBLIC, so a
      // signature-only /revoke was replayable into a griefing DoS (anyone who saw a provider
      // via /lookup could knock it out). Revocation rides signed EXPIRY (passive) + the g-240
      // on-chain isRevoked hook (active, authoritative) — both already enforced at lookup.
      // Secure self-service revoke = a phase-2 challenge-response (fresh nonce).

      return json(res, 404, { error: 'not found' })
    } catch {
      return json(res, 500, { error: 'internal error' })
    }
  }

  const server = http.createServer(handler)
  return { server, store, handler, applied: { network, requireRegistryCheck, allowlist: !!trusted } }
}
