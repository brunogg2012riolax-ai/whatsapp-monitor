const Datastore = require('nedb-promises');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data');

const messagesDb = Datastore.create({ 
  filename: path.join(DB_PATH, 'messages.db'), 
  autoload: true 
});

const instancesDb = Datastore.create({ 
  filename: path.join(DB_PATH, 'instances.db'), 
  autoload: true 
});

async function getPendingConversations(instanceId = null) {
  let query = { type: 'received' };
  if (instanceId) query.instanceId = instanceId;

  const allReceived = await messagesDb.find(query).sort({ timestamp: -1 });

  // Pegar última mensagem por contato
  const lastByContact = {};
  for (const msg of allReceived) {
    const key = msg.instanceId + '|' + msg.phone;
    if (!lastByContact[key]) lastByContact[key] = msg;
  }

  // Verificar se a última mensagem geral é do cliente (não da vendedora)
  const pending = [];
  for (const key of Object.keys(lastByContact)) {
    const [instId, phone] = key.split('|');
    const lastMsg = await messagesDb.findOne({ instanceId: instId, phone })
      .sort !== undefined 
      ? await messagesDb.find({ instanceId: instId, phone }).sort({ timestamp: -1 }).limit(1)
      : [lastByContact[key]];
    
    const last = Array.isArray(lastMsg) ? lastMsg[0] : lastMsg;
    if (last && last.type === 'received') {
      const inst = await instancesDb.findOne({ id: instId });
      pending.push({
        ...last,
        instance_id: last.instanceId,
        last_message: last.message,
        last_timestamp: last.timestamp,
        last_type: last.type,
        instance_name: inst ? inst.name : instId,
        contact_name: last.contactName
      });
    }
  }

  return pending.sort((a, b) => a.last_timestamp - b.last_timestamp);
}

async function getAllConversationsStats(instanceId = null) {
  let query = {};
  if (instanceId) query.instanceId = instanceId;

  const allMessages = await messagesDb.find(query);
  
  const contacts = new Set(allMessages.map(m => m.instanceId + '|' + m.phone));
  const pending = await getPendingConversations(instanceId);
  
  const now = Math.floor(Date.now() / 1000);
  const startOfDay = Math.floor(new Date().setHours(0,0,0,0) / 1000);
  
  let respondedQuery = { type: 'sent', timestamp: { $gte: startOfDay } };
  if (instanceId) respondedQuery.instanceId = instanceId;
  const sentToday = await messagesDb.find(respondedQuery);
  const respondedPhones = new Set(sentToday.map(m => m.instanceId + '|' + m.phone));

  return {
    total: contacts.size,
    pending: pending.length,
    pendingCritical: pending.filter(c => (now - c.last_timestamp) / 60 > 120).length,
    respondedToday: respondedPhones.size
  };
}

async function getConversationHistory(instanceId, phone, limit = 50) {
  const msgs = await messagesDb.find({ instanceId, phone }).sort({ timestamp: -1 }).limit(limit);
  return msgs;
}

async function saveMessage({ instanceId, phone, contactName, message, type, timestamp }) {
  return messagesDb.insert({
    instanceId, phone, contactName, message, type,
    timestamp: timestamp || Math.floor(Date.now() / 1000),
    createdAt: Date.now()
  });
}

async function upsertInstance({ id, name, token }) {
  const existing = await instancesDb.findOne({ id });
  if (existing) {
    return instancesDb.update({ id }, { $set: { name, token } });
  }
  return instancesDb.insert({ id, name, token, createdAt: Date.now() });
}

async function getInstances() {
  return instancesDb.find({});
}

module.exports = {
  getPendingConversations,
  getAllConversationsStats,
  getConversationHistory,
  saveMessage,
  upsertInstance,
  getInstances
};
