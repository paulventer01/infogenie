'use strict';

function present(key) {
  const v = process.env[key];
  return !!(v && String(v).trim() && !/^_DUMMY/i.test(String(v)));
}

function firstPresent(...keys) {
  for (const k of keys) {
    if (present(k)) return k;
  }
  return null;
}

module.exports = { present, firstPresent };
