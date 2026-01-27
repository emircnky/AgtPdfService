const express = require('express');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');
const hbs = require('handlebars');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

// ----------------------
// Handlebars helpers
// ----------------------
hbs.registerHelper('eq', function (a, b) {
  return a === b;
});

// ----------------------
// Health check
// ----------------------
app.get('/', (req, res) => {
  res.status(200).send('AGT PDF Servisi Aktif! 🚀');
});

// GET test endpoint
app.get('/generate-quote', (req, res) => {
  res.status(200).send('OK (POST required)');
});

// ----------------------
// Global browser
// ----------------------
let browser;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    console.log('Tarayıcı başlatılıyor...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote'
      ]
    });
  }
  return browser;
}

async function safeClosePage(page) {
  if (!page) return;
  try { await page.close(); } catch (e) {}
}

// ✅ Puppeteer v24+ page.pdf() -> Uint8Array dönebiliyor
// Bu yüzden assert ve base64 için Buffer'a çeviriyoruz.
function assertPdfBytes(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  if (!buf || buf.length < 1000) {
    throw new Error('PDF buffer empty/small. len=' + (buf ? buf.length : 0));
  }

  // "%PDF" kontrolü byte bazlı
  if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) {
    const head = Array.from(buf.subarray(0, 8)).join(',');
    throw new Error('Not a PDF. headBytes=' + head);
  }

  return buf; // Buffer döndür
}

// ----------------------
// MAIN: Generate Quote PDF
// ----------------------
app.post('/generate-quote', async (req, res) => {
  let page = null;

  try {
    const data = req.body || {};
    const reqId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    console.log(`[${reqId}] /generate-quote request received`);

    // Template adı sende manager_report.hbs
    const templatePath = path.join(__dirname, 'views', 'manager_report.hbs');

    if (!fs.existsSync(templatePath)) {
      console.error(`[${reqId}] Template missing: ${templatePath}`);
      res.status(500);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send('PDF_ERROR: Template file not found: ' + templatePath);
    }

    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    const template = hbs.compile(templateHtml, { noEscape: true });
    const finalHtml = template(data);

    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();

    await page.setViewport({ width: 1280, height: 720 });
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    // İçerik
    await page.setContent(finalHtml, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // External asset'ler (typekit vb.) bazen takılır; bekle ama takılırsa geç
    try {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 60000 });
    } catch (e) {
      console.log(`[${reqId}] waitForNetworkIdle skipped: ${e.message}`);
    }

    // PDF üret (✅ burada Uint8Array gelebilir)
    const pdfBytes = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    await safeClosePage(page);
    page = null;

    // ✅ Validate + Buffer'a çevir
    const pdfBuf = assertPdfBytes(pdfBytes);

    // ✅ Base64 doğru şekilde Buffer'dan alınır
    const pdfBase64 = pdfBuf.toString('base64');

    console.log(`[${reqId}] PDF OK bytes=${pdfBuf.length} base64len=${pdfBase64.length}`);

    return res.status(200).json({
      status: 'Success',
      base64: pdfBase64,
      bytes: pdfBuf.length
    });

  } catch (error) {
    console.error('Generate Quote PDF Error:', error);
    await safeClosePage(page);

    const msg = (error && (error.stack || error.message)) ? (error.stack || error.message) : String(error);

    res.status(500);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send('PDF_ERROR: ' + msg);
  }
});

// ----------------------
// Server start
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor!`);
  try {
    await getBrowser();
    console.log('Browser warm started.');
  } catch (e) {
    console.log('Browser warm start failed:', e.message);
  }
});
