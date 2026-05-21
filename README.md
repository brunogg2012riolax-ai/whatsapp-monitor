# 📱 Monitor de Atendimento WhatsApp

Sistema de monitoramento de conversas do WhatsApp para lojas, com painel em tempo real e relatório diário por e-mail.

## ✅ Funcionalidades

- Visualiza conversas pendentes de resposta em tempo real
- Indica há quanto tempo cada cliente está aguardando
- Filtra por número de WhatsApp (instância)
- Relatório diário automático por e-mail
- Funciona com múltiplos números simultâneos

## 🚀 Deploy no Railway

### Pré-requisitos
- Conta no [Railway.app](https://railway.app)
- Conta na [Z-API](https://z-api.io) com instância(s) criada(s)
- Repositório no GitHub com este código

### Variáveis de ambiente no Railway

Configure as seguintes variáveis em **Settings → Variables**:

| Variável | Descrição | Exemplo |
|---|---|---|
| `PORT` | Porta do servidor (Railway define automaticamente) | `3000` |
| `REPORT_HOUR` | Hora do relatório diário (fuso Recife) | `8` |
| `EMAIL_HOST` | Servidor SMTP | `smtp.gmail.com` |
| `EMAIL_PORT` | Porta SMTP | `587` |
| `EMAIL_USER` | E-mail remetente | `loja@gmail.com` |
| `EMAIL_PASS` | Senha de app do Google | `xxxx xxxx xxxx xxxx` |
| `EMAIL_TO` | E-mail(s) destinatário(s) | `dono@gmail.com,esposa@gmail.com` |

### Como gerar Senha de App do Google
1. Acesse myaccount.google.com
2. Segurança → Verificação em 2 etapas (ative se não tiver)
3. Segurança → Senhas de app
4. Gere uma senha para "E-mail"
5. Use essa senha no campo `EMAIL_PASS`

## 📡 Configurar Webhook na Z-API

Para cada instância, configure o webhook em:
**Z-API → Instâncias Web → Webhooks e configurações gerais**

- **URL de recebimento:** `https://SEU-APP.railway.app/webhook/ID_DA_INSTANCIA`
- **URL de envio:** `https://SEU-APP.railway.app/webhook/ID_DA_INSTANCIA`

Substitua `ID_DA_INSTANCIA` pelo ID real da instância Z-API.

## 🖥️ Usando o painel

1. Acesse a URL do seu app no Railway
2. Clique em ⚙️ para configurar as instâncias
3. Adicione: Nome, ID e Token de cada instância Z-API
4. Salve e comece a monitorar!
