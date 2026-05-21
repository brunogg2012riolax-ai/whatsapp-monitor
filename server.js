const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Garante que o diretório de dados existe
const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Inicializa banco de dados SQLite
const dbPath = path.join(dataDir, 'conversations.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT NOT NULL,
    instance_name TEXT NOT NULL DEFAULT 'Instância',
    phone TEXT NOT NULL,
    contact_name TEXT,
    content TEXT NOT NULL DEFAULT '',
    timestamp INTEGER NOT NULL,
    direction TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_instance_phone_ts
    ON messages(instance_id, phone, timestamp DESC);
`);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ───────────────────────────────────────────────────────────────
// WEBHOOK — recebe eventos do Z-API
// URL para configurar no Z-API: POST /webhook/{instanceId}?name=NomeDaVendedora
// ───────────────────────────────────────────────────────────────
app.post('/webhook/:instanceId', (req, res) => {
  const { instanceId } = req.params;
  const instanceName = req.query.name || `Instância ${instanceId.slice(-4)}`;
  const data = req.body;

  try {
    const phone = data.phone;

    // Ignora mensagens de grupos
    if (!phone || phone.includes('@g.us') || phone.includes('-')) {
      return res.json({ ok: true, skipped: 'group' });
    }

    let content = '';
    let direction = null;

    if (data.type === 'ReceivedCallback') {
      direction = 'received';
      content =
        data.text?.message ||
        (data.image ? `📷 ${data.image.caption || 'Foto'}` : null) ||
        (data.audio ? '🎵 Áudio' : null) ||
        (data.video ? '🎥 Vídeo' : null) ||
        (data.document ? `📄 ${data.document.fileName || 'Documento'}` : null) ||
        (data.sticker ? '😊 Figurinha' : null) ||
        (data.location ? '📍 Localização' : null) ||
        '[Mensagem]';
    } else if (data.type === 'SentCallback') {
      direction = 'sent';
      content =
        data.text?.message ||
        (data.image ? '📷 Foto enviada' : null) ||
        (data.audio ? '🎵 Áudio enviado' : null) ||
        (data.video ? '🎥 Vídeo enviado' : null) ||
        '[Mensagem enviada]';
    }

    if (direction) {
      const contactName = data.senderName || data.chatName || phone;
      const timestamp = data.momment || Date.now();

      db.prepare(`
        INSERT INTO messages (instance_id, instance_name, phone, contact_name, content, timestamp, direction)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(instanceId, instanceName, phone, contactName, content, timestamp, direction);

      console.log(`[${direction.toUpperCase()}] ${instanceName} | ${contactName}: ${content.slice(0, 60)}`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Webhook Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ───────────────────────────────────────────────────────────────
// API: Conversas pendentes (último msg foi do cliente)
// ───────────────────────────────────────────────────────────────
app.get('/api/pending', (req, res) => {
  const { instance } = req.query;
  const now = Date.now();

  const sql = `
    SELECT
      m.instance_id,
      m.instance_name,
      m.phone,
      m.contact_name,
      m.content as last_message,
      m.timestamp,
      m.direction,
      ? - m.timestamp as waiting_ms
    FROM messages m
    WHERE m.id = (
      SELECT id FROM messages
      WHERE instance_id = m.instance_id AND phone = m.phone
      ORDER BY timestamp DESC LIMIT 1
    )
    AND m.direction = 'received'
    ${instance ? 'AND m.instance_id = ?' : ''}
    ORDER BY m.timestamp ASC
  `;

  const params = instance ? [now, instance] : [now];

  try {
    const rows = db.prepare(sql).all(...params);
    const result = rows.map(row => ({
      ...row,
      waiting_display: formatWaitTime(row.waiting_ms),
      urgency: row.waiting_ms > 7200000 ? 'critical'
             : row.waiting_ms > 3600000 ? 'warning'
             : 'ok'
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ───────────────────────────────────────────────────────────────
// API: Estatísticas do dashboard
// ───────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    const pending = db.prepare(`
      SELECT m.timestamp
      FROM messages m
      WHERE m.id = (
        SELECT id FROM messages
        WHERE instance_id = m.instance_id AND phone = m.phone
        ORDER BY timestamp DESC LIMIT 1
      )
      AND m.direction = 'received'
    `).all();

    let critical = 0, warning = 0, ok = 0;
    for (const row of pending) {
      const w = now - row.timestamp;
      if (w > 7200000) critical++;
      else if (w > 3600000) warning++;
      else ok++;
    }

    const respondedToday = db.prepare(`
      SELECT COUNT(DISTINCT instance_id || '|' || phone) as count
      FROM messages
      WHERE direction = 'sent' AND timestamp >= ?
    `).get(todayStart.getTime()).count;

    res.json({
      critical,
      warning,
      ok,
      total_pending: pending.length,
      responded_today: respondedToday
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───────────────────────────────────────────────────────────────
// API: Lista de instâncias conectadas
// ───────────────────────────────────────────────────────────────
app.get('/api/instances', (req, res) => {
  try {
    const instances = db.prepare(`
      SELECT DISTINCT instance_id, instance_name
      FROM messages
      ORDER BY instance_name
    `).all();
    res.json(instances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// ───────────────────────────────────────────────────────────────
function formatWaitTime(ms) {
  if (ms < 60000) return 'Agora';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

app.listen(PORT, () => {
  console.log(`✅ WhatsApp Monitor rodando na porta ${PORT}`);
  console.log(`📁 Banco de dados: ${dbPath}`);
});
