// overlay.test.js — g-288 Indelible Overlay Node. verify (standalone, byte-match to the
// bridge — no BSL), store (idempotent + sybil cap + expiry/revoke), and the node handler
// with all 5 pack fixes (allowlist, signed expiry, network-bind, fail-closed registry, revoke).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, Hash } from '@bsv/sdk'
import { verifyAnnouncement, isExpired, canonicalize, ANNOUNCEMENT_PROTOCOL } from '../verify.mjs'
import { DirectoryStore } from '../store.mjs'
import { createOverlayNode } from '../overlay.mjs'

const SIGN_DOMAIN = 'indelible-agent-cap-v1\n'
const CAP = (name = 'proof') => ({ name, topic: `tm_indelible_${name}`, route: 'GET /proof/:txid', price: 0, metered: false })

// Mirrors the bridge's buildAnnouncement signing exactly (SHA-256 + ECDSA DER over the
// domain-prefixed canonical form) — proves the standalone node verifies real bridge sigs.
function sign (priv, { endpoint = 'https://x', network = 'testnet', capabilities = [CAP()], ttlMs = 86_400_000 } = {}) {
  const announcement = {
    protocol: ANNOUNCEMENT_PROTOCOL,
    providerPubKey: priv.toPublicKey().toString(),
    endpoint,
    network,
    capabilities,
    announcedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMs).toISOString()
  }
  const hex = Buffer.from(SIGN_DOMAIN + canonicalize(announcement), 'utf8').toString('hex')
  const signature = priv.sign(Hash.sha256(Buffer.from(hex, 'hex'))).toDER('hex')
  return { announcement, signature }
}

// Mock req/res so we exercise the REAL handler without binding a port.
const mkReq = (method, path, bodyObj, headers = {}) => {
  const body = bodyObj == null ? '' : JSON.stringify(bodyObj)
  async function * gen () { if (body) yield Buffer.from(body, 'utf8') }
  const it = gen()
  return { method, url: path, headers, socket: { remoteAddress: headers['x-ip'] || '1.2.3.4' }, [Symbol.asyncIterator]: () => it, destroy () {} }
}
const mkRes = () => ({ writeHead (s) { this.status = s }, end (b) { this.raw = b; try { this.body = b ? JSON.parse(b) : null } catch { this.body = null } } })
const call = async (node, method, path, bodyObj, headers) => { const res = mkRes(); await node.handler(mkReq(method, path, bodyObj, headers), res); return res }

describe('verify — byte-identical to the bridge, no BSL', () => {
  const priv = PrivateKey.fromRandom()
  it('valid announcement verifies', () => assert.equal(verifyAnnouncement(sign(priv)), true))
  it('verifies a FROZEN real bridge-built announcement [byte-match — no cross-repo import]', () => {
    // captured from the bridge's discovery.js buildAnnouncement — proves this node verifies REAL
    // bridge output, so canonicalize + SIGN_DOMAIN stay byte-identical across the public/private line.
    const frozen = { announcement: { protocol: 'indelible-agent-cap-v1', providerPubKey: '03102ff7dd63395492c631591ccc63aba4150556f46a3c066efa7145e8ad227ab5', endpoint: 'https://frozen.example', network: 'testnet', capabilities: [{ name: 'proof', topic: 'tm_indelible_proof', route: 'GET /proof/:txid', price: 0, metered: false, wellKnown: '/.well-known/x402' }], announcedAt: '2026-06-10T16:01:30.273Z', expiresAt: '2026-06-11T16:01:30.274Z' }, signature: '304402205a5649b03346b53c85535804bf68af32e8083e0e93cc932d0a62c0dc52bc5f790220251391b95a3c4ca1b8541baa9ce66e708fd44b6e796ab2407ab5da512c162c52' }
    assert.equal(verifyAnnouncement(frozen), true)
    assert.equal(verifyAnnouncement({ announcement: { ...frozen.announcement, endpoint: 'https://evil' }, signature: frozen.signature }), false)
  })
  it('tampered endpoint fails', () => { const a = sign(priv); a.announcement.endpoint = 'https://evil'; assert.equal(verifyAnnouncement(a), false) })
  it('swapped providerPubKey fails (key is inside the signed payload)', () => { const a = sign(priv); a.announcement.providerPubKey = PrivateKey.fromRandom().toPublicKey().toString(); assert.equal(verifyAnnouncement(a), false) })
  it('wrong protocol / missing sig fails', () => {
    const a = sign(priv); a.announcement.protocol = 'nope'; assert.equal(verifyAnnouncement(a), false)
    assert.equal(verifyAnnouncement({ announcement: sign(priv).announcement }), false)
  })
})

describe('isExpired [pack #2]', () => {
  const priv = PrivateKey.fromRandom()
  it('future expiresAt → not expired', () => assert.equal(isExpired(sign(priv).announcement), false))
  it('past expiresAt → expired', () => assert.equal(isExpired(sign(priv, { ttlMs: -1000 }).announcement), true))
  it('missing expiresAt → treated as expired', () => assert.equal(isExpired({}), true))
})

describe('DirectoryStore — idempotent + sybil cap + expiry/revoke [pack #1/#2]', () => {
  it('put then lookup returns it', () => {
    const s = new DirectoryStore(); s.put(sign(PrivateKey.fromRandom()))
    assert.equal(s.lookup('tm_indelible_proof').length, 1)
  })
  it('idempotent by provider (re-put refreshes, no growth)', () => {
    const s = new DirectoryStore(); const priv = PrivateKey.fromRandom()
    s.put(sign(priv)); s.put(sign(priv)); assert.equal(s.lookup('tm_indelible_proof').length, 1)
  })
  it('maxPerTopic refuses NEW providers when full — never evicts an established one [diff #3]', () => {
    const s = new DirectoryStore({ maxPerTopic: 3 })
    const keep = PrivateKey.fromRandom()
    s.put(sign(keep))                                                   // established provider, in first
    for (let i = 0; i < 4; i++) s.put(sign(PrivateKey.fromRandom()))    // sybil flood
    const got = s.lookup('tm_indelible_proof')
    assert.equal(got.length, 3)
    assert.ok(got.some(e => e.announcement.providerPubKey === keep.toPublicKey().toString()))   // established kept, flood refused
    assert.equal(s.put(sign(keep)).stored, true)                        // and it still refreshes in place at cap (idempotent)
  })
  it('expired dropped on lookup', () => {
    const s = new DirectoryStore(); s.put(sign(PrivateKey.fromRandom(), { ttlMs: -1000 }))
    assert.equal(s.lookup('tm_indelible_proof').length, 0)
  })
  it('isRevoked drops on lookup; revoke() removes', () => {
    const s = new DirectoryStore(); const priv = PrivateKey.fromRandom(); const pub = priv.toPublicKey().toString()
    s.put(sign(priv))
    assert.equal(s.lookup('tm_indelible_proof', Date.now(), p => p === pub).length, 0)
    s.put(sign(priv)); assert.equal(s.revoke(pub), 1); assert.equal(s.lookup('tm_indelible_proof').length, 0)
  })
})

describe('node handler — submit/lookup + all 5 pack fixes', () => {
  it('submit (allowlisted) → 200, then lookup returns it (caller re-verifies)', async () => {
    const priv = PrivateKey.fromRandom(); const node = createOverlayNode({ network: 'testnet', trustedProviders: [priv.toPublicKey().toString()] })
    const s = await call(node, 'POST', '/submit', sign(priv)); assert.equal(s.status, 200); assert.deepEqual(s.body.topics, ['tm_indelible_proof'])
    const l = await call(node, 'POST', '/lookup', { service: 'ls_indelible', query: { topic: 'tm_indelible_proof' } })
    assert.equal(l.status, 200); assert.equal(l.body.type, 'announcement-list'); assert.equal(l.body.announcements.length, 1)
    assert.equal(verifyAnnouncement(l.body.announcements[0]), true)
  })
  it('bad signature → 400 [no forgery]', async () => {
    const node = createOverlayNode(); const a = sign(PrivateKey.fromRandom()); a.announcement.endpoint = 'https://evil'
    assert.equal((await call(node, 'POST', '/submit', a)).status, 400)
  })
  it('network mismatch → 400 [pack #4]', async () => {
    const priv = PrivateKey.fromRandom(); const node = createOverlayNode({ network: 'mainnet', trustedProviders: [priv.toPublicKey().toString()] })
    assert.equal((await call(node, 'POST', '/submit', sign(priv, { network: 'testnet' }))).status, 400)
  })
  it('expired → 400 [pack #2]', async () => {
    const priv = PrivateKey.fromRandom(); const node = createOverlayNode({ trustedProviders: [priv.toPublicKey().toString()] })
    assert.equal((await call(node, 'POST', '/submit', sign(priv, { ttlMs: -1000 }))).status, 400)
  })
  it('not allowlisted → 403 [pack #1]', async () => {
    const node = createOverlayNode({ trustedProviders: [PrivateKey.fromRandom().toPublicKey().toString()] })
    assert.equal((await call(node, 'POST', '/submit', sign(PrivateKey.fromRandom()))).status, 403)
  })
  it('registry unreachable on mainnet → 503 FAIL-CLOSED [pack #5]', async () => {
    const node = createOverlayNode({ network: 'testnet', requireRegistryCheck: true, registryCheck: async () => { throw new Error('down') } })
    assert.equal((await call(node, 'POST', '/submit', sign(PrivateKey.fromRandom()))).status, 503)
  })
  it('TTL beyond maxTtlMs → 400; within cap → 200 [diff #4]', async () => {
    const priv = PrivateKey.fromRandom(); const node = createOverlayNode({ trustedProviders: [priv.toPublicKey().toString()], maxTtlMs: 60_000 })
    assert.equal((await call(node, 'POST', '/submit', sign(priv, { ttlMs: 86_400_000 }))).status, 400)   // 1-day TTL, node caps at 60s
    assert.equal((await call(node, 'POST', '/submit', sign(priv, { ttlMs: 30_000 }))).status, 200)        // within cap
  })
  it('rate limit → 429 [pack #1]', async () => {
    const node = createOverlayNode({ rateLimitPerMin: 2 })
    await call(node, 'POST', '/submit', {}); await call(node, 'POST', '/submit', {})
    assert.equal((await call(node, 'POST', '/submit', {})).status, 429)
  })
  it('health → 200', async () => { assert.equal((await call(createOverlayNode(), 'GET', '/health')).status, 200) })
  it('GET / serves the dashboard HTML [indexer parity]', async () => {
    const r = await call(createOverlayNode(), 'GET', '/')
    assert.equal(r.status, 200); assert.match(r.raw, /INDELIBLE OVERLAY|<!DOCTYPE html>/i)
  })
  it('GET /directory lists topics + providers [dashboard]', async () => {
    const priv = PrivateKey.fromRandom(); const node = createOverlayNode({ trustedProviders: [priv.toPublicKey().toString()] })
    await call(node, 'POST', '/submit', sign(priv))
    const d = await call(node, 'GET', '/directory')
    assert.equal(d.status, 200); assert.equal(d.body.topics.length, 1)
    assert.equal(d.body.topics[0].topic, 'tm_indelible_proof'); assert.equal(d.body.topics[0].providers.length, 1)
  })
})
