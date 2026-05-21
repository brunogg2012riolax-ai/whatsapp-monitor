const { Resend } = require('resend');
const { getPendingConversations } = require('./database');

function formatTimeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours/24)}d`;
}

function getUrgencyColor(timestamp) {
  const minutesAgo = (Date.now() / 1000 - timestamp) / 60;
  if (minutesAgo > 120) return '#f04a6a';
  if (minutesAgo > 60) return '#f5a623';
  return '#26d87c';
}

async function sendDailyReport(emailConfig) {
  if (!emailConfig || !emailConfig.to || !emailConfig.apiKey) {
    console.log('E-mail não configurado.');
    return;
  }

  const resend = new Resend(emailConfig.apiKey);
  const pending = await getPendingConversations();
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife' });
  const critical = pending.filter(c => (Date.now()/1000 - c.last_timestamp)/60 > 120).length;
  const warning = pending.filter(c => { const m=(Date.now()/1000-c.last_timestamp)/60; return m>60&&m<=120; }).length;

  let rows = '';
  if (pending.length === 0) {
    rows = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#6b7280;">✅ Nenhuma conversa pendente!</td></tr>';
  } else {
    pending.forEach(c => {
      const color = getUrgencyColor(c.last_timestamp);
      const timeAgo = formatTimeAgo(c.last_timestamp);
      const name = c.contact_name || c.phone;
      const phone = (c.phone||'').replace('@c.us','');
      const inst = c.instance_name || c.instance_id || '';
      const message = (c.last_message||'(mídia)').substring(0,100);
      rows += `<tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:12px 16px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:8px;"></span><strong>${name}</strong><br><small style="color:#9ca3af;">${phone}</small></td>
        <td style="padding:12px 16px;">${inst}</td>
        <td style="padding:12px 16px;color:${color};font-weight:600;">${timeAgo}</td>
        <td style="padding:12px 16px;font-style:italic;">"${message}"</td>
      </tr>`;
    });
  }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <div style="max-width:680px;margin:0 auto;padding:32px 16px;">
    <div style="background:#1a1a2e;border-radius:16px;padding:32px;margin-bottom:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:24px;">📱 Relatório de Atendimento</h1>
      <p style="color:#9ca3af;margin:8px 0 0;">${now}</p>
    </div>
    <div style="display:flex;gap:16px;margin-bottom:24px;">
      <div style="flex:1;background:#fff;border-radius:12px;padding:20px;text-align:center;border:2px solid ${critical>0?'#f04a6a':'#e5e7eb'};">
        <div style="font-size:32px;font-weight:800;color:#f04a6a;">${critical}</div>
        <div style="font-size:13px;color:#6b7280;">🔴 Urgentes (+2h)</div>
      </div>
      <div style="flex:1;background:#fff;border-radius:12px;padding:20px;text-align:center;border:2px solid ${warning>0?'#f5a623':'#e5e7eb'};">
        <div style="font-size:32px;font-weight:800;color:#f5a623;">${warning}</div>
        <div style="font-size:13px;color:#6b7280;">🟡 Atenção (1-2h)</div>
      </div>
      <div style="flex:1;background:#fff;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:32px;font-weight:800;color:#6b7280;">${pending.length}</div>
        <div style="font-size:13px;color:#6b7280;">📋 Total pendente</div>
      </div>
    </div>
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#1a1a2e;padding:16px 20px;">
        <h2 style="color:#fff;margin:0;font-size:16px;">Conversas sem resposta</h2>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f9fafb;">
          <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;">CLIENTE</th>
          <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;">NÚMERO</th>
          <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;">TEMPO</th>
          <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;">ÚLTIMA MENSAGEM</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div></body></html>`;

  const result = await resend.emails.send({
    from: 'Monitor WhatsApp <onboarding@resend.dev>',
    to: emailConfig.to.split(',').map(e => e.trim()),
    subject: `📊 Relatório — ${pending.length} pendente${pending.length!==1?'s':''} ${critical>0?'🔴':''}`,
    html
  });

  console.log('✅ Relatório enviado!', result);
}

module.exports = { sendDailyReport };
