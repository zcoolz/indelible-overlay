#!/usr/bin/env node
// start.mjs — runnable entry for the Indelible Overlay Node. Config from env + optional
// JSON file (OVERLAY_CONFIG). Generic by default; gate it with trustedProviders (testnet)
// or requireRegistryCheck (mainnet) — otherwise it runs OPEN (warned).
import { readFileSync } from 'node:fs'
import { createOverlayNode } from './overlay.mjs'

let fileCfg = {}
const cfgPath = process.env.OVERLAY_CONFIG
if (cfgPath) {
  try { fileCfg = JSON.parse(readFileSync(cfgPath, 'utf8')) } catch (e) { console.error('[overlay] config read failed:', e.message) }
}

const config = {
  network: process.env.OVERLAY_NETWORK || fileCfg.network || 'testnet',
  trustedProviders: fileCfg.trustedProviders,
  requireRegistryCheck: fileCfg.requireRegistryCheck ?? false,
  maxPerTopic: fileCfg.maxPerTopic,
  maxTopics: fileCfg.maxTopics,
  rateLimitPerMin: fileCfg.rateLimitPerMin
}
const port = Number(process.env.OVERLAY_PORT || fileCfg.port || 8788)

const { server, applied } = createOverlayNode(config)
if (!applied.allowlist && !applied.requireRegistryCheck) {
  console.warn('[overlay] ⚠️  OPEN MODE — no trustedProviders allowlist and no registry check. ' +
    'Signature + rate-limit + maxPerTopic still apply, but ANY signed key may advertise. ' +
    'Set trustedProviders (testnet) or requireRegistryCheck (mainnet) to gate.')
}
server.listen(port, () => console.log(`[overlay] indelible-overlay listening on :${port} (${applied.network})`))
