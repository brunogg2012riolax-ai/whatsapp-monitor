const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal') 
    ? false 
    : { rejectUnauthorized: false }
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token TEXT NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      instance_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      contact_name TEXT,
      message TEXT,
      type TEXT NOT NULL CHECK(type IN ('received','sent')),
      timestamp BIGINT NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    );

    CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(instance_id, phone, timestamp);
  `);
  console.log('✅ Banco de dados iniciado!');
}

initSchema().catch(console.error);

async function getPendingConversations(instanceId = null) {
  const query = `
    WITH last_msg AS (
      SELECT DISTINCT ON (instance_id, phone)
        instance_id, phone, contact_name, message, type, timestamp
      FROM messages
      ORDER BY instance_id, phone, timestamp DESC
    ),
    last_sent AS (
      SELECT instance_id, phone, MAX(timestamp) as last_sent_ts
      FROM messages WHERE type = 'sent'
      GROUP BY instance_id, phone
    )
    SELECT 
      lm.instance_id, lm.phone, lm.contact_name,
      lm.message as last_message, lm.type as last_type,
      lm.timestamp as last_timestamp,
      i.name as instance_name
    FROM last_msg lm
    LEFT JOIN last_sent ls ON lm.instance_id = ls.instance_id AND lm.phone = ls.phone
    LEFT JOIN instances i ON lm.instance_id = i.id
    WHERE lm.type = 'received'
    ${instanceId ? `AND lm.instance_id = $1` : ''}
    ORDER BY lm.timestamp ASC
  `;
  const values = instanceId ? [instanceId] : [];
  const result = await pool.query(query, values);
  return result.rows;
}

async function getAllConversationsStats(instanceId = null) {
  const pending = await getPendingConversations(instanceId);
  const now = Math.floor(Date.now() / 1000);
  const startOfDay = Math.floor(new Date().setHours(0,0,0,0) / 1000);

  const totalQuery = instanceId
    ? `SELECT COUNT(DISTINCT phone || instance_id) as count FROM messages WHERE instance_id = $1`
    : `SELECT COUNT(DISTINCT phone || instance_id) as count FROM messages`;
  const totalResult = await pool.query(totalQuery, instanceId ? [instanceId] : []);

  const respondedQuery = instanceId
    ? `SELECT COUNT(DISTINCT phone) as count FROM messages WHERE type = 'sent' AND timestamp >= $1 AND instance_id = $2`
    : `SELECT COUNT(DISTINCT phone || instance_id) as count FROM messages WHERE type = 'sent' AND timestamp >= $1`;
  const respondedResult = await pool.query(respondedQuery, instanceId ? [startOfDay, instanceId] : [startOfDay]);

  return {
    total: parseInt(totalResult.rows[0].count),
    pending: pending.length,
    pendingCritical: pending.filter(c => (now - c.last_timestamp) / 60 > 120).length,
    respondedToday: parseInt(respondedResult.rows[0].count)
  };
}

async function getConversationHistory(instanceId, phone, limit = 50) {
  const result = await pool.query(
    `SELECT * FROM messages WHERE instance_id = $1 AND phone = $2 ORDER BY timestamp DESC LIMIT $3`,
    [instanceId, phone, limit]
  );
  return result.rows;
}

async function saveMessage({ instanceId, phone, contactName, message, type, timestamp }) {
  await pool.query(
    `INSERT INTO messages (instance_id, phone, contact_name, message, type, timestamp) VALUES ($1,$2,$3,$4,$5,$6)`,
    [instanceId, phone, contactName, message, type, timestamp || Math.floor(Date.now() / 1000)]
  );
}

async function upsertInstance({ id, name, token }) {
  await pool.query(
    `INSERT INTO instances (id, name, token) VALUES ($1,$2,$3)
     ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, token=EXCLUDED.token`,
    [id, name, token]
  );
}

async function getInstances() {
  const result = await pool.query('SELECT * FROM instances ORDER BY created_at');
  return result.rows;
}

module.exports = {
  getPendingConversations,
  getAllConversationsStats,
  getConversationHistory,
  saveMessage,
  upsertInstance,
  getInstances
};
