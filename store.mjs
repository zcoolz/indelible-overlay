// store.mjs — in-memory directory store for the overlay node (g-288).
// topic → records, idempotent by (providerPubKey, topic), maxPerTopic cap [pack #1],
// expiry + revocation eviction [pack #2]. In-memory is right for the minimal release:
// a single node's live directory is small and self-heals from re-submits. A level/file
// backend is a drop-in (same put/lookup/revoke surface).
import { isExpired } from './verify.mjs'

export class DirectoryStore {
  constructor ({ maxPerTopic = 64, maxTopics = 4096 } = {}) {
    this._topics = new Map()              // topic → Map(providerPubKey → { announcement, signature, receivedAt })
    this.maxPerTopic = maxPerTopic
    this.maxTopics = maxTopics
  }

  /**
   * Store/refresh a verified announcement under each of its capability topics.
   * Idempotent by provider (a re-submit refreshes in place — no growth). When a topic
   * is at cap and a NEW provider arrives, evict the oldest-received to bound sybil
   * growth [pack #1]. Returns { stored, topics }.
   */
  put ({ announcement, signature }, now = Date.now()) {
    const caps = Array.isArray(announcement?.capabilities) ? announcement.capabilities : []
    const topics = [...new Set(caps.map(c => c?.topic).filter(t => typeof t === 'string' && t))]
    if (!topics.length) return { stored: false, topics: [], error: 'no topics' }
    const pub = announcement.providerPubKey
    const stored = []
    for (const topic of topics) {
      let m = this._topics.get(topic)
      // refuse-when-full: at cap + a NEW provider → skip. NEVER evict an established
      // provider — eviction would let a sybil flood eject the honest record [diff #3].
      // An existing provider always refreshes in place. Real deployments gate /submit
      // (allowlist/registry), so the cap is a memory bound, not an attack surface.
      if (m && !m.has(pub) && m.size >= this.maxPerTopic) continue
      if (!m) {
        if (this._topics.size >= this.maxTopics) continue
        m = new Map()
        this._topics.set(topic, m)
      }
      m.set(pub, { announcement, signature, receivedAt: now })
      stored.push(topic)
    }
    return stored.length ? { stored: true, topics: stored } : { stored: false, topics: [], error: 'topic(s) at capacity' }
  }

  /**
   * All non-expired, non-revoked records for a topic (drops them as it finds them).
   * The CALLER still re-verifies every signature — the node is an untrusted directory.
   */
  lookup (topic, now = Date.now(), isRevoked = null) {
    const m = this._topics.get(topic)
    if (!m) return []
    const out = []
    for (const [pub, rec] of [...m]) {
      if (isExpired(rec.announcement, now)) { m.delete(pub); continue }        // [pack #2] drop expired
      if (isRevoked && isRevoked(pub)) { m.delete(pub); continue }             // [pack #2] g-240 revocation-aware
      out.push({ announcement: rec.announcement, signature: rec.signature })
    }
    if (m.size === 0) this._topics.delete(topic)
    return out
  }

  /** Remove all records for a provider (signed /revoke) [pack #2]. Returns count removed. */
  revoke (providerPubKey) {
    let removed = 0
    for (const [topic, m] of [...this._topics]) {
      if (m.delete(providerPubKey)) removed++
      if (m.size === 0) this._topics.delete(topic)
    }
    return removed
  }

  /** Snapshot of the whole directory (non-expired, non-revoked) — for the dashboard [g-288]. */
  directory (now = Date.now(), isRevoked = null) {
    const out = []
    for (const [topic, m] of [...this._topics]) {
      const providers = []
      for (const [pub, rec] of [...m]) {
        if (isExpired(rec.announcement, now)) { m.delete(pub); continue }
        if (isRevoked && isRevoked(pub)) { m.delete(pub); continue }
        const a = rec.announcement
        providers.push({ providerPubKey: pub, endpoint: a.endpoint, network: a.network, announcedAt: a.announcedAt, expiresAt: a.expiresAt, capabilities: a.capabilities })
      }
      if (providers.length) out.push({ topic, providers })
      else this._topics.delete(topic)
    }
    return out
  }

  stats () {
    let records = 0
    for (const m of this._topics.values()) records += m.size
    return { topics: this._topics.size, records }
  }
}
