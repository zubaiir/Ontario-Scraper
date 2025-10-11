const crypto = require('crypto');

/**
 * Generate a fingerprint hash for deduplication
 * 
 * @param {string} input - String to hash
 * @returns {string} - SHA256 hash (40 characters)
 */
function generateFingerprint(input) {
  return crypto
    .createHash('sha256')
    .update(input)
    .digest('hex')
    .slice(0, 40);
}

module.exports = {
  crypto,
  generateFingerprint
};
