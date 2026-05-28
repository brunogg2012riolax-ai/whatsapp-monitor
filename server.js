require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const {
  saveMessage,
  getPendingConversations,
  getAllConversationsStats,
  getConversationHistory,
  upsertInstance,
  getInstances
} = require('./src/database');

const { sendDailyReport } = require('./src/emailReport');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── WEBHOOK Z-API ────────────────────────────────────────────────────────────

app.post('/webhook/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const body = req.body;
    const type = body.type;
    const phone = body.phone || body.from || body.to || body.chatId;
    const text = body.text?.message || body.caption || body.body || '';
    const ts = body.momment || body.timestamp || Date.now();
    const timestamp = ts > 9999999999 ? Math.floor(ts / 1000) : ts;

    console.log(`[WEBHOOK] type: ${type} | fromMe: ${body.fromMe} | phone: ${phone}`);

    if (!phone || phone.includes('@g.us')) {
      return res.json({ status: 'ok' });
    }

    if (type === 'ReceivedCallback') {
  if (body.fromMe === true) {
  // Busca o número real pelo chatLid na tabela de mensagens
  const { pool } = require('./src/database');
  const chatLid = body.phone || body.chatId;
  
  // Tenta achar o número real associado a esse chatLid
  const result = await pool.query(
    `SELECT phone FROM messages WHERE instance_id = $1 AND (phone = $2 OR phone LIKE $3) ORDER BY timestamp DESC LIMIT 1`,
    [instanceId, chatLid, `%${chatLid.replace('@lid','').replace('@c.us','')}%`]
  );
  
  const realPhone = result.rows.length > 0 ? result.rows[0].phone : chatLid;
  
  console.log(`[DEBUG] chatLid: ${chatLid} → realPhone: ${realPhone}`);
  
  await saveMessage({
    instanceId,
    phone: realPhone,
    contactName: null,
    message: text || '(mídia)',
    type: 'sent',
    timestamp
  });
  console.log(`[📤 Enviada] para ${realPhone}: ${text?.substring(0, 50)}`);
}
    }

    if (type === 'SentCallback') {
      await saveMessage({
        instanceId, phone,
        contactName: null,
        message: text || '(mídia)',
        type: 'sent',
        timestamp
      });
      console.log(`[📤 Enviada] para ${phone}: ${text?.substring(0, 50)}`);
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[Webhook Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── API ──────────────────────────────────────────────────────────────────────

app.post('/api/fix-messages', async (req, res) => {
  try {
    const { pool } = require('./src/database');
    await pool.query('DELETE FROM messages');
    console.log('✅ Mensagens antigas removidas!');
    res.json({ success: true, message: 'Banco limpo!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pending', async (req, res) => {
  try {
    const pending = await getPendingConversations(req.query.instanceId || null);
    res.json(pending);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getAllConversationsStats(req.query.instanceId || null);
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conversation/:instanceId/:phone', async (req, res) => {
  try {
    const history = await getConversationHistory(
      req.params.instanceId,
      decodeURIComponent(req.params.phone)
    );
    res.json(history);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/instances', async (req, res) => {
  try {
    res.json(await getInstances());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/instances', async (req, res) => {
  try {
    const { id, name, token } = req.body;
    if (!id || !name || !token) return res.status(400).json({ error: 'id, name e token são obrigatórios' });
    await upsertInstance({ id, name, token });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/report/send', async (req, res) => {
  try {
    const emailConfig = {
      apiKey: process.env.RESEND_API_KEY,
      to: process.env.EMAIL_TO
    };
    console.log('📧 Tentando enviar relatório para:', emailConfig.to);
    await sendDailyReport(emailConfig);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ ERRO NO RELATÓRIO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── CRON ─────────────────────────────────────────────────────────────────────

const REPORT_HOUR = process.env.REPORT_HOUR || '22';
cron.schedule(`0 ${REPORT_HOUR} * * *`, async () => {
  await sendDailyReport({
    apiKey: process.env.RESEND_API_KEY,
    to: process.env.EMAIL_TO
  });
}, { timezone: 'America/Recife' });

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Monitor rodando na porta ${PORT}`);
});
