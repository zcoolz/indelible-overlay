// verify.mjs — standalone announcement verification for the Indelible Overlay Node (g-288).
// MIT, @bsv/sdk ONLY — byte-identical to the bridge's discovery.js signHash/verifyHash
// (SHA-256 + ECDSA DER) + canonicalize, so the node verifies REAL bridge announcements
// without importing any BSL code (same self-contained pattern as the indexer release).
//
// The node is an UNTRUSTED directory: it verifies on admission, but every CALLER must
// re-verify too. Trust is the SIGNATURE (+ the identity gate), NEVER the node.
import { Hash, Signature, PublicKey } from '@bsv/sdk'

export const ANNOUNCEMENT_PROTOCOL = 'indelible-agent-cap-v1'
// Domain separation — MUST match discovery.js exactly (a flipped byte breaks every verify).
const SIGN_DOMAIN = 'indelible-agent-cap-v1\n'

/** Recursive SORTED-KEY canonical JSON — byte-identical to discovery.js canonicalize. */
export function canonicalize (value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(v => canonicalize(v) ?? 'null').join(',') + ']'
  const keys = Object.keys(value).sort().filter(k => value[k] !== undefined)
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}'
}

const announcementHex = (a) => Buffer.from(SIGN_DOMAIN + canonicalize(a), 'utf8').toString('hex')

function verifyHash (dataHex, sigDerHex, pubkeyHex) {
  const hash = Hash.sha256(Buffer.from(dataHex, 'hex'))
  const sig = Signature.fromDER(sigDerHex, 'hex')
  return PublicKey.fromString(pubkeyHex).verify(hash, sig)
}

/**
 * Verify the signature is by announcement.providerPubKey over the canonical payload
 * (which INCLUDES providerPubKey — so a forger can't swap in their own key without
 * invalidating the sig). Returns false on any malformity.
 */
export function verifyAnnouncement ({ announcement, signature } = {}) {
  if (!announcement || typeof announcement !== 'object') return false
  if (announcement.protocol !== ANNOUNCEMENT_PROTOCOL) return false
  const pub = announcement.providerPubKey
  if (typeof pub !== 'string' || !pub) return false
  if (typeof signature !== 'string' || !signature) return false
  try { return verifyHash(announcementHex(announcement), signature, pub) } catch { return false }
}

/**
 * Expired? expiresAt is a SIGNED ISO-8601 string [pack #2]. Missing/unparseable →
 * treated as EXPIRED (reject) — an announcement with no honest expiry is not admissible.
 */
export function isExpired (announcement, now = Date.now()) {
  const exp = Date.parse(announcement?.expiresAt)
  if (!Number.isFinite(exp)) return true
  return now >= exp
}
