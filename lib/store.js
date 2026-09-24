// Order storage. Uses MongoDB when MONGODB_URI is set (recommended on Render,
// whose disk is ephemeral); falls back to a local JSON file otherwise.
const fs = require('fs');
const path = require('path');

function matches(row, query) {
  return Object.entries(query).every(([k, v]) => row[k] === v);
}

function jsonStore(file) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } };
  const write = rows => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(rows, null, 2)); };
  return {
    kind: 'json',
    async create(row) { const rows = read(); rows.push(row); write(rows); return row; },
    async get(id) { return read().find(r => r.id === id) || null; },
    async findOne(query) { return read().find(r => matches(r, query)) || null; },
    async update(id, patch) {
      const rows = read(); const i = rows.findIndex(r => r.id === id); if (i < 0) return null;
      rows[i] = { ...rows[i], ...patch, updatedAt: new Date().toISOString() }; write(rows); return rows[i];
    },
    async list(limit = 200) { return read().slice(-limit).reverse(); }
  };
}

function mongoStore(uri, dbName) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri);
  let colP;
  const col = () => (colP ||= client.connect().then(async c => {
    const col = c.db(dbName).collection('orders');
    await col.createIndex({ id: 1 }, { unique: true });
    await col.createIndex({ stripeSessionId: 1 });
    await col.createIndex({ stripeSubscriptionId: 1 });
    return col;
  }));
  const strip = d => { if (!d) return null; const { _id, ...rest } = d; return rest; };
  return {
    kind: 'mongodb',
    async create(row) { await (await col()).insertOne({ ...row }); return row; },
    async get(id) { return strip(await (await col()).findOne({ id })); },
    async findOne(query) { return strip(await (await col()).findOne(query)); },
    async update(id, patch) {
      const r = await (await col()).findOneAndUpdate({ id }, { $set: { ...patch, updatedAt: new Date().toISOString() } }, { returnDocument: 'after' });
      return strip(r && r.value !== undefined ? r.value : r);
    },
    async list(limit = 200) { return (await (await col()).find({}).sort({ createdAt: -1 }).limit(limit).toArray()).map(strip); }
  };
}

function createStore() {
  if (process.env.MONGODB_URI) return mongoStore(process.env.MONGODB_URI.trim(), process.env.MONGODB_DB || 'queenee');
  return jsonStore(process.env.QUEENEE_DATA_FILE || path.join(__dirname, '..', 'data', 'orders.json'));
}

module.exports = { createStore, jsonStore };
