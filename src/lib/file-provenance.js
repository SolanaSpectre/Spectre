const crypto = require('crypto');
const fs = require('fs');

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function fileProvenance(filePath, options = {}) {
  if (!filePath) {
    return {
      path: null,
      exists: false,
      sha256: null,
      bytes: 0,
      rowCount: null
    };
  }
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      sha256: null,
      bytes: 0,
      rowCount: null
    };
  }

  const buffer = fs.readFileSync(filePath);
  const json = options.jsonArrayPath ? readJsonFile(filePath) : null;
  let rowCount = null;
  if (json && options.jsonArrayPath) {
    const rows = options.jsonArrayPath
      .split('.')
      .filter(Boolean)
      .reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), json);
    rowCount = Array.isArray(rows) ? rows.length : null;
  }

  return {
    path: filePath,
    exists: true,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.length,
    rowCount
  };
}

module.exports = {
  fileProvenance
};
