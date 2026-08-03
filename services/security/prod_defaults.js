// services/security/prod_defaults.js — Resolve rollout flags with prod-safe defaults.
'use strict';

/**
 * Production defaults: enforcement ON unless explicitly overridden.
 * Dev/test: keep staged defaults (shadow/off) so local work isn't blocked.
 */
function resolveRolloutFlag(envName, { prodDefault, devDefault }) {
  const explicit = process.env[envName];
  if (explicit != null && String(explicit).trim() !== '') {
    return String(explicit).toLowerCase().trim();
  }
  return process.env.NODE_ENV === 'production' ? prodDefault : devDefault;
}

function permissionMode() {
  return resolveRolloutFlag('PERMISSION_ENFORCEMENT', { prodDefault: 'on', devDefault: 'shadow' });
}

function multitenantMode() {
  return resolveRolloutFlag('MULTITENANT_ENFORCEMENT', { prodDefault: 'on', devDefault: 'off' });
}

function csrfMode() {
  return resolveRolloutFlag('SECURITY_CSRF', { prodDefault: 'on', devDefault: 'shadow' });
}

module.exports = {
  resolveRolloutFlag,
  permissionMode,
  multitenantMode,
  csrfMode,
};
