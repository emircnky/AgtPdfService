const express = require('express');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');
const hbs = require('handlebars');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

// ----------------------
// Font base64 yükleme
// ----------------------
const fontRegularB64 = fs.readFileSync(path.join(__dirname, 'TRAJANPRO-REGULAR.OTF')).toString('base64');
const fontBoldB64 = fs.readFileSync(path.join(__dirname, 'TRAJANPRO-BOLD.OTF')).toString('base64');

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

function assertPdfBytes(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  if (!buf || buf.length < 1000) {
    throw new Error('PDF buffer empty/small. len=' + (buf ? buf.length : 0));
  }

  if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) {
    const head = Array.from(buf.subarray(0, 8)).join(',');
    throw new Error('Not a PDF. headBytes=' + head);
  }

  return buf;
}

/**
 * Ortak PDF üretim fonksiyonu
 */
async function renderPdfFromTemplate(req, res, templateFile, pdfOptions = {}) {
  let page = null;

  try {
    const data = req.body || {};
    const reqId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    console.log(`[${reqId}] ${req.path} request received template=${templateFile}`);

    const templatePath = path.join(__dirname, 'views', templateFile);

    if (!fs.existsSync(templatePath)) {
      console.error(`[${reqId}] Template missing: ${templatePath}`);
      res.status(500);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send('PDF_ERROR: Template file not found: ' + templatePath);
    }

    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    const template = hbs.compile(templateHtml, { noEscape: true });
    const finalHtml = template({ ...data, fontRegularB64, fontBoldB64 });

    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();

    const timeoutMs = pdfOptions.timeoutMs || 60000;
    await page.setViewport({ width: 1280, height: 720 });
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);

    await page.setContent(finalHtml, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    try {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: timeoutMs });
    } catch (e) {
      console.log(`[${reqId}] waitForNetworkIdle skipped: ${e.message}`);
    }

    const pdfBytes = await page.pdf({
      format: 'A4',
      landscape: !!pdfOptions.landscape,
      printBackground: true,
      margin: pdfOptions.margin || { top: '0', right: '0', bottom: '0', left: '0' }
    });

    await safeClosePage(page);
    page = null;

    const pdfBuf = assertPdfBytes(pdfBytes);
    const pdfBase64 = pdfBuf.toString('base64');

    console.log(`[${reqId}] PDF OK bytes=${pdfBuf.length} base64len=${pdfBase64.length}`);

    return res.status(200).json({
      status: 'Success',
      base64: pdfBase64,
      bytes: pdfBuf.length
    });

  } catch (error) {
    console.error('PDF Error:', error);
    await safeClosePage(page);

    const msg = (error && (error.stack || error.message)) ? (error.stack || error.message) : String(error);

    res.status(500);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send('PDF_ERROR: ' + msg);
  }
}

// ----------------------
// Quote PDF Endpoints
// ----------------------
app.get('/generate-quote', (req, res) => {
  res.status(200).send('OK (POST required)');
});

app.post('/generate-quote', async (req, res) => {
  return renderPdfFromTemplate(req, res, 'manager_report.hbs', {
    landscape: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });
});

// ----------------------
// Quote PDF ENG Endpoints
// ----------------------
app.get('/generate-quote-eng', (req, res) => {
  res.status(200).send('OK (POST required)');
});

app.post('/generate-quote-eng', async (req, res) => {
  return renderPdfFromTemplate(req, res, 'manager_report_eng.hbs', {
    landscape: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });
});

// ----------------------
// OrderForm PDF Endpoints
// ----------------------
app.get('/generate-order-form', (req, res) => {
  res.status(200).send('OK (POST required)');
});

app.post('/generate-order-form', async (req, res) => {
  return renderPdfFromTemplate(req, res, 'order_form.hbs', {
    landscape: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });
});

// ----------------------
// OrderForm ENG PDF Endpoints
// ----------------------
app.get('/generate-order-form-eng', (req, res) => {
  res.status(200).send('OK (POST required)');
});

app.post('/generate-order-form-eng', async (req, res) => {
  return renderPdfFromTemplate(req, res, 'order_form_eng.hbs', {
    landscape: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });
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