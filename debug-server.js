const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const DUMP_DIR = __dirname;
const HTML_FILE = path.join(DUMP_DIR, 'page_dump.html');
const SUMMARY_FILE = path.join(DUMP_DIR, 'page_summary.json');
const LOG_FILE = path.join(DUMP_DIR, 'debug_logs.txt');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');

        if (req.url === '/dump') {
          console.log(`[Bridge Server] Received full page dump from: ${data.url || 'unknown'}`);
          
          let targetHtmlFile = HTML_FILE;
          let targetSummaryFile = SUMMARY_FILE;

          if (data.url && (data.url.includes('infosysapps.com') || data.url.includes('/contest/'))) {
            targetHtmlFile = path.join(DUMP_DIR, 'contest_dump.html');
            targetSummaryFile = path.join(DUMP_DIR, 'contest_summary.json');
          } else if (data.url && data.url.includes('viewer/iap')) {
            targetHtmlFile = path.join(DUMP_DIR, 'viewer_iap_dump.html');
            targetSummaryFile = path.join(DUMP_DIR, 'viewer_iap_summary.json');
          }

          if (data.html) {
            fs.writeFileSync(targetHtmlFile, data.html, 'utf8');
          }

          const summary = {
            url: data.url,
            title: data.title,
            timestamp: new Date().toISOString(),
            formsCount: data.formsCount,
            inputsCount: data.inputsCount,
            buttons: data.buttons || [],
            questionsFound: data.questions || []
          };
          fs.writeFileSync(targetSummaryFile, JSON.stringify(summary, null, 2), 'utf8');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Dump saved successfully.' }));
          return;
        }

        if (req.url === '/log') {
          const logLine = `[${new Date().toISOString()}] [${data.level || 'INFO'}] ${data.message}\n`;
          fs.appendFileSync(LOG_FILE, logLine, 'utf8');
          console.log(`[Browser Log] ${data.message}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      } catch (err) {
        console.error('[Bridge Server] Error processing request:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`=================================================`);
  console.log(`[READY] AI Live Debug Bridge running at http://127.0.0.1:${PORT}`);
  console.log(`Ready to receive DOM dumps and logs from browser!`);
  console.log(`=================================================`);
});
