const { createHash } = require('crypto');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function inviteTokenFromUrl(storedUrl) {
  try {
    const parsed = new URL(storedUrl);
    const match = parsed.pathname.match(/^\/invite\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

async function validateStoredBootstrapUrl(storedUrl, client) {
  const token = inviteTokenFromUrl(storedUrl);
  if (!token) return false;

  const result = await client.query(
    `SELECT 1
     FROM invites
     WHERE invite_type = $1
       AND token_hash = $2
       AND accepted_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    ['bootstrap_ceo', hashToken(token)],
  );
  return result.rowCount === 1;
}

module.exports = { hashToken, validateStoredBootstrapUrl };