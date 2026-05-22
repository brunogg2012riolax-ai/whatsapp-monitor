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

    if (type === 'ReceivedCallback' || body.isNewMsg) {
      const phone = body.phone || body.from || body.chatId;
      const text = body.text?.message || body.caption || body.body || '';
      const contactName = body.senderName || body.pushName || body.notifyName || '';
      const ts = body.momment || body.timestamp || Date.now();
      const timestamp = ts > 9999999999 ? Math.floor(ts / 1000) : ts;

      if (phone && !phone.includes('@g.us')) {
        await saveMessage({
          instanceId, phone, contactName,
          message: text || '(mídia)',
          type: 'received',
          timestamp: Math.floor(timestamp)
        });
        console.log(`[✅ Recebida] ${contactName || phone}: ${text?.substring(0, 50)}`);
      }
    }

    if (type === 'SentCallback' || body.isSentByMe || body.fromMe === true) {
      const phone = body.phone || body.to || body.chatId;
      const text = body.text?.message || body.caption || body.body || '';
      const ts = body.momment || body.timestamp || Date.now();
      const timestamp = ts > 9999999999 ? Math.floor(ts / 1000) : ts;

      if (phone && !phone.includes('@g.us')) {
        await saveMessage({
          instanceId, phone,
          contactName: null,
          message: text || '(mídia)',
          type: 'sent',
          timestamp: Math.floor(timestamp)
        });
        console.log(`[📤 Enviada] para ${phone}`);
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[Webhook Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── API ──────────────────────────────────────────────────────────────────────

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
  console.error(err.stack);
  res.status(500).json({ error: err.message });
}
});

// ─── CRON ─────────────────────────────────────────────────────────────────────

const REPORT_HOUR = process.env.REPORT_HOUR || '8';
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
