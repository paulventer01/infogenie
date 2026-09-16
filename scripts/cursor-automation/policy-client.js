'use strict';

const { client, ApiError } = require('./client');
const ROOT = '/repos/paulventer01/infogenie';

function allowedPolicyPath(path) {
  if (typeof path !== 'string') return false;
  let branch;
  if (path.startsWith(`${ROOT}/branches/`) && path.endsWith('/protection/required_status_checks')) {
    branch = path.slice(`${ROOT}/branches/`.length, -'/protection/required_status_checks'.length);
  } else if (path.startsWith(`${ROOT}/rules/branches/`)) {
    branch = path.slice(`${ROOT}/rules/branches/`.length);
    const query = branch.indexOf('?');
    if (query !== -1) {
      if (!/^\?per_page=100&page=([1-9]|1[0-9]|20)$/.test(branch.slice(query))) return false;
      branch = branch.slice(0, query);
    }
  } else return false;
  try {
    const decoded = decodeURIComponent(branch);
    return /^[A-Za-z0-9._/-]{1,200}$/.test(decoded) && !decoded.includes('..')
      && !decoded.startsWith('/') && !decoded.endsWith('/') && encodeURIComponent(decoded) === branch;
  } catch (_) { return false; }
}

function policyClient(token, github, fetchImpl = fetch) {
  const dedicated = typeof token === 'string' && token.length > 0;
  const request = dedicated ? client('https://api.github.com', token, 'GitHub', fetchImpl) : github;
  const read = async (method, path, body) => {
    if (method !== 'GET' || body !== undefined || !allowedPolicyPath(path)) {
      throw new Error('Policy client permits only same-repository protection/rules GETs.');
    }
    try {
      const result = await request(method, path);
      if (dedicated && JSON.stringify(result)?.includes(token)) throw new ApiError('GitHub', 0);
      return result;
    } catch (error) {
      // A dedicated credential's 404 can hide a scope/access error. Do not infer absence.
      if (dedicated && error.status === 404) throw new ApiError('GitHub', 403);
      // Never include thrown remote text or a credential in diagnostics.
      throw new ApiError('GitHub', Number.isInteger(error.status) ? error.status : 0);
    }
  };
  read.credentialSource = dedicated ? 'CURSOR_POLICY_READ_TOKEN' : 'GITHUB_TOKEN';
  return read;
}

module.exports = { policyClient };
