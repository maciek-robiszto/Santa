import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createCipher } from '../src/crypto.js';
import { createStore } from '../src/store.js';
import { createApp } from '../src/app.js';

export async function startTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'santa-test-'));
  const config = loadConfig({ DATA_DIR: dir, ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), APP_URL: 'http://localhost:0' });
  const store = createStore(openDb(config.dbFile), createCipher(config.encryptionKey));
  const sent = [];
  const mailer = { enabled: true, send: async (m) => { sent.push(m); } };
  const app = createApp({ config, store, mailer });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  config.origin = base;
  return {
    dir, config, store, mailer, sent, base,
    client: () => new Client(base),
    close() { server.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

export class Client {
  cookies = new Map();
  constructor(base) { this.base = base; }
  async req(method, url, form) {
    const headers = { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ _csrf: this.cookies.get('csrf') ?? '', ...form }).toString();
    }
    const res = await fetch(this.base + url, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i), val = pair.slice(i + 1);
      if (!val || /Expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k); else this.cookies.set(k, val);
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text(), headers: res.headers };
  }
  get(url) { return this.req('GET', url); }
  async post(url, form) { if (!this.cookies.has('csrf')) await this.get('/'); return this.req('POST', url, form); }
}
