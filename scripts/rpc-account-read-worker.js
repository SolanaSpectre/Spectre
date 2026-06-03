#!/usr/bin/env node
'use strict';

const https = require('https');

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function rpc({ url, method, params, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(new Error(`invalid RPC URL: ${error.message}`));
      return;
    }

    if (parsed.protocol !== 'https:') {
      reject(new Error('only https RPC URLs are supported'));
      return;
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: `${Date.now()}-${process.pid}`,
      method,
      params
    });

    const request = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname || '/'}${parsed.search || ''}`,
      method: 'POST',
      agent: false,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${text.slice(0, 200)}`));
          return;
        }

        let payload;
        try {
          payload = JSON.parse(text);
        } catch (error) {
          reject(new Error(`invalid JSON: ${error.message}`));
          return;
        }

        if (payload?.error) {
          reject(new Error(payload.error.message || JSON.stringify(payload.error)));
          return;
        }

        resolve(payload?.result);
      });
    });

    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`socket timed out after ${timeoutMs}ms`));
    });
    request.end(body);
  });
}

async function main() {
  const input = await readStdin();
  const request = JSON.parse(input);
  const timeoutMs = Number.isFinite(Number(request.timeoutMs))
    ? Math.max(1000, Math.floor(Number(request.timeoutMs)))
    : 10000;
  const result = await rpc({ ...request, timeoutMs });
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message || String(error) })}\n`);
  process.exitCode = 1;
});
