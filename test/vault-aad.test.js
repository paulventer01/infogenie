// test/vault-aad.test.js — optional AES-GCM AAD on the credential vault.
//
// ./helpers/env must be required BEFORE the vault so the harness
// CREDENTIAL_ENCRYPTION_KEY is in place when vault._loadKey() caches it. No key
// material is defined here; the harness owns the test key.
require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert');

const vault = require('../services/credentials/vault');

const AAD_T1 = 'meeting_notes_runs:tenant:1';
const AAD_T2 = 'meeting_notes_runs:tenant:2';
const SECRET = 'notes-plaintext-under-test';

test('vault exports encryptString/decryptString', () => {
  assert.strictEqual(typeof vault.encryptString, 'function');
  assert.strictEqual(typeof vault.decryptString, 'function');
  assert.ok(vault.hasKey(), 'harness key should be loaded');
});

test('no-AAD payloads round-trip exactly as before (legacy rows stay readable)', () => {
  const { ciphertext, iv, tag } = vault.encryptString(SECRET);
  assert.strictEqual(vault.decryptString(ciphertext, iv, tag), SECRET);
});

test('AAD payload round-trips with the same AAD', () => {
  const { ciphertext, iv, tag } = vault.encryptString(SECRET, AAD_T1);
  assert.strictEqual(vault.decryptString(ciphertext, iv, tag, AAD_T1), SECRET);
});

test('Buffer AAD is equivalent to the same string AAD', () => {
  const { ciphertext, iv, tag } = vault.encryptString(SECRET, Buffer.from(AAD_T1, 'utf8'));
  assert.strictEqual(vault.decryptString(ciphertext, iv, tag, AAD_T1), SECRET);
});

test('a different tenant AAD fails authentication', () => {
  const { ciphertext, iv, tag } = vault.encryptString(SECRET, AAD_T1);
  assert.throws(() => vault.decryptString(ciphertext, iv, tag, AAD_T2));
});

test('omitting the AAD on decrypt fails authentication', () => {
  const { ciphertext, iv, tag } = vault.encryptString(SECRET, AAD_T1);
  assert.throws(() => vault.decryptString(ciphertext, iv, tag));
  assert.throws(() => vault.decryptString(ciphertext, iv, tag, null));
});

test('supplying an AAD for a payload encrypted without one fails authentication', () => {
  const { ciphertext, iv, tag } = vault.encryptString(SECRET);
  assert.throws(() => vault.decryptString(ciphertext, iv, tag, AAD_T1));
});

test('AAD does not leak into the ciphertext length and each iv is unique', () => {
  const a = vault.encryptString(SECRET, AAD_T1);
  const b = vault.encryptString(SECRET, AAD_T1);
  assert.strictEqual(a.ciphertext.length, Buffer.byteLength(SECRET, 'utf8'));
  assert.strictEqual(a.iv.length, 12);
  assert.strictEqual(a.tag.length, 16);
  assert.notStrictEqual(a.iv.toString('base64'), b.iv.toString('base64'));
});
