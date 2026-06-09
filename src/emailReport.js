const { Resend } = require('resend');
const ExcelJS = require('exceljs');
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

function getUrgencyLabel(timestamp) {
  const minutes = (Date.now() / 1000 - timestamp) / 60;
  if (minutes > 120) return '🔴 Urgente (+2h)';
  if (minutes > 60) return '🟡 Atenção (1-2h)';
  return '🟢 Normal';
}

async function generateExcel(pending) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Pendentes');

  // Colunas
  sheet.columns = [
    { header: 'Cliente', key: 'cliente', width: 30 },
    { header: 'Telefone', key: 'telefone', width: 20 },
    { header: 'Atendente', key: 'atendente', width: 20 },
    { header: 'Última Mensagem', key: 'mensagem', width: 50 },
    { header: 'Tempo sem resposta', key: 'tempo', width: 20 },
    { header: 'Status', key: 'status', width: 20 },
  ];

  // Estilo do cabeçalho
  sheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a1a2e' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF22c55e' } }
    };
  });
  sheet.getRow(1).height = 30;

  // Dados
  pending.forEach(c => {
    const minutes = (Date.now() / 1000 - c.last_timestamp) / 60;
    const row = sheet.addRow({
      cliente: c.contact_name || c.phone,
      telefone: (c.phone || '').replace(/\D/g, '').replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '+$1 ($2) $3-$4'),
      atendente: c.instance_name || c.instance_id,
      mensagem: c.last_message || '(mídia)',
      tempo: formatTimeAgo(c.last_timestamp),
      status: getUrgencyLabel(c.last_timestamp)
    });

    // Cor por urgência
    const bgColor = minutes > 120 ? 'FFFEE2E2' : minutes > 60 ? 'FFFEF9C3' : 'FFF0FDF4';
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });
    row.height = 25;
  });

  // Linha de totais
  const totalRow = sheet.addRow({
    cliente: `Total: ${pending.length} conversa(s) pendente(s)`,
    telefone: '', atendente: '', mensagem: '', tempo: '', status: ''
  });
  totalRow.getCell(1).font = { bold: true };
  totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  // Congela o cabeçalho
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'F1' };

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
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

  // Gera o Excel
  const excelBuffer = await generateExcel(pending);
  const excelBase64 = Buffer.from(excelBuffer).toString('base64');
  const today = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');

  let rows = '';
  if (pending.length === 0) {
    rows = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#6b7280;">✅ Nenhuma conversa pendente!</td></tr>';
  } else {
    pending.forEach(c => {
      const minutes = (Date.now()/1000 - c.last_timestamp)/60;
      const color = minutes > 120 ? '#ef4444' : minutes > 60 ? '#f59e0b' : '#22c55e';
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
      <div style="flex:1;background:#fff;border-radius:12px;padding:20px;text-align:center;border:2px solid ${critical>0?'#ef4444':'#e5e7eb'};">
        <div style="font-size:32px;font-weight:800;color:#ef4444;">${critical}</div>
        <div style="font-size:13px;color:#6b7280;">🔴 Urgentes (+2h)</div>
      </div>
      <div style="flex:1;background:#fff;border-radius:12px;padding:20px;text-align:center;border:2px solid ${warning>0?'#f59e0b':'#e5e7eb'};">
        <div style="font-size:32px;font-weight:800;color:#f59e0b;">${warning}</div>
        <div style="font-size:13px;color:#6b7280;">🟡 Atenção (1-2h)</div>
      </div>
      <div style="flex:1;background:#fff;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:32px;font-weight:800;color:#6b7280;">${pending.length}</div>
        <div style="font-size:13px;color:#6b7280;">📋 Total pendente</div>
      </div>
    </div>
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;margin-bottom:16px;">
      <div style="background:#1a1a2e;padding:16px 20px;">
        <h2 style="color:#fff;margin:0;font-size:16px;">Conversas sem resposta</h2>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f9fafb;">
          <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;">CLIENTE</th>
          <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;">ATENDENTE</th>
          <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;">TEMPO</th>
          <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;">ÚLTIMA MENSAGEM</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;font-size:13px;color:#166534;">
      📎 Planilha Excel em anexo — filtre por atendente e encaminhe para cada uma!
    </p>
  </div></body></html>`;

  await resend.emails.send({
    from: 'Monitor WhatsApp <onboarding@resend.dev>',
    to: emailConfig.to.split(',').map(e => e.trim()),
    subject: `📊 Relatório ${today} — ${pending.length} pendente${pending.length!==1?'s':''} ${critical>0?'🔴':''}`,
    html,
    attachments: [
      {
        filename: `relatorio-atendimento-${today}.xlsx`,
        content: excelBase64,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    ]
  });

  console.log(`✅ Relatório com Excel enviado para ${emailConfig.to}`);
}

module.exports = { sendDailyReport };
