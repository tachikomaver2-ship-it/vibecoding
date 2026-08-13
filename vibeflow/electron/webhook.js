// Lightweight webhook receiver so external platforms (Slack, Discord, Zapier,
// IFTTT, browser extensions...) can POST inspirations into the knowledge base.
// Listens only on 127.0.0.1.
const http = require('http');

function startWebhook(store, emit) {
  const port = (store.state.settings && store.state.settings.webhookPort) || 18720;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') {
      return res.end(JSON.stringify({ service: 'vibeflow-webhook', status: 'ok', port }));
    }
    if (req.method === 'POST' && req.url === '/webhook') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const channelId = data.channelId || store.state.channels[0].id;
          store.addInboxItem({
            channelId,
            title: data.title || '未命名灵感',
            content: data.content || '',
            source: data.source || 'webhook',
            author: data.author || 'webhook',
          });
          store.save();
          emit();
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
  });

  server.on('error', (e) => console.error('[webhook]', e.message));
  server.listen(port, '127.0.0.1', () => console.log(`[webhook] listening on http://127.0.0.1:${port}/webhook`));
  return server;
}

module.exports = { startWebhook };
