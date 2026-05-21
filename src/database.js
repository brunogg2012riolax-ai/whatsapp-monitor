const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      contact_name TEXT,
      message TEXT,
      type TEXT NOT NULL CHECK(type IN ('received', 'sent')),
      timestamp INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(instance_id, phone, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  `);
}

// Get all pending conversations (customer sent last message)
function getPendingConversations(instanceId = null) {
  const db = getDb();
  
  let query = `
    WITH last_messages AS (
      SELECT 
        instance_id,
        phone,
        MAX(timestamp) as last_ts
      FROM messages
      GROUP BY instance_id, phone
    ),
    last_msg_detail AS (
      SELECT 
        m.instance_id,
        m.phone,
        m.contact_name,
        m.message,
        m.type,
        m.timestamp
      FROM messages m
      INNER JOIN last_messages lm 
        ON m.instance_id = lm.instance_id 
        AND m.phone = lm.phone 
        AND m.timestamp = lm.last_ts
    ),
    last_received AS (
      SELECT 
        instance_id,
        phone,
        MAX(timestamp) as last_received_ts
      FROM messages
      WHERE type = 'received'
      GROUP BY instance_id, phone
    ),
    last_sent AS (
      SELECT 
        instance_id,
        phone,
        MAX(timestamp) as last_sent_ts
      FROM messages
      WHERE type = 'sent'
      GROUP BY instance_id, phone
    )
    SELECT 
      lmd.instance_id,
      lmd.phone,
      lmd.contact_name,
      lmd.message as last_message,
      lmd.type as last_type,
      lmd.timestamp as last_timestamp,
      COALESCE(lr.last_received_ts, 0) as last_received_ts,
      COALESCE(ls.last_sent_ts, 0) as last_sent_ts,
      i.name as instance_name
    FROM last_msg_detail lmd
    LEFT JOIN last_received lr ON lmd.instance_id = lr.instance_id AND lmd.phone = lr.phone
    LEFT JOIN last_sent ls ON lmd.instance_id = ls.instance_id AND lmd.phone = ls.phone
    LEFT JOIN instances i ON lmd.instance_id = i.id
    WHERE lmd.type = 'received'
  `;

  if (instanceId) {
    query += ` AND lmd.instance_id = '${instanceId}'`;
  }

  query += ` ORDER BY lmd.timestamp ASC`;

  return db.prepare(query).all();
}

// Get all conversations (for stats)
function getAllConversationsStats(instanceId = null) {
  const db = getDb();
  
  let whereClause = instanceId ? `WHERE instance_id = '${instanceId}'` : '';
  
  const total = db.prepare(`SELECT COUNT(DISTINCT phone || instance_id) as count FROM messages ${whereClause}`).get();
  
  const pending = getPendingConversations(instanceId);
  
  const respondedToday = db.prepare(`
    WITH last_sent AS (
      SELECT instance_id, phone, MAX(timestamp) as last_sent_ts
      FROM messages WHERE type = 'sent' ${instanceId ? `AND instance_id = '${instanceId}'` : ''}
      GROUP BY instance_id, phone
    )
    SELECT COUNT(*) as count FROM last_sent
    WHERE last_sent_ts >= strftime('%s','now','start of day')
  `).get();

  return {
    total: total.count,
    pending: pending.length,
    pendingCritical: pending.filter(c => {
      const minutesAgo = (Date.now() / 1000 - c.last_timestamp) / 60;
      return minutesAgo > 120;
    }).length,
    respondedToday: respondedToday.count
  };
}

// Get conversation history for a specific contact
function getConversationHistory(instanceId, phone, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM messages 
    WHERE instance_id = ? AND phone = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(instanceId, phone, limit);
}

// Save a message
function saveMessage({ instanceId, phone, contactName, message, type, timestamp }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO messages (instance_id, phone, contact_name, message, type, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(instanceId, phone, contactName, message, type, timestamp || Math.floor(Date.now() / 1000));
}

// Get or create instance
function upsertInstance({ id, name, token }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO instances (id, name, token) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, token=excluded.token
  `).run(id, name, token);
}

function getInstances() {
  const db = getDb();
  return db.prepare('SELECT * FROM instances').all();
}

module.exports = {
  getDb,
  getPendingConversations,
  getAllConversationsStats,
  getConversationHistory,
  saveMessage,
  upsertInstance,
  getInstances
};
