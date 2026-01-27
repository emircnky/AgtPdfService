const express = require('express');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');
const hbs = require('handlebars');
const fs = require('fs');
const path = require('path');

const app = express();

// Render / proxy / büyük payload için güvenli limit
app.use(bodyParser.json({ limit: '50mb' }));

// (Opsiyonel) basic CORS – Salesforce callout için genelde gerekmez ama tarayıcı testinde işe yarar
// const cors = require('cors');
// app.use(cors({ origin: '*'}));

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

// Endpoint test (GET ile “Cannot GET” görmeyesin)
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

// Render bazen idle kalabiliyor -> güvenli yardımcı
async function safeClosePage(page) {
  if (!page) return;
  try { await page.close(); } catch (e) {}
}

// PDF doğrulama: %PDF + min size
function assertPdfBuffer(pdfBuffer) {
  if (!pdfBuffer || pdfBuffer.length < 1000) {
    throw new Error('PDF buffer empty/small. len=' + (pdfBuffer ? pdfBuffer.length : 0));
  }
  const header = pdfBuffer.subarray(0, 4).toString('utf8');
  if (header !== '%PDF') {
    throw new Error('Not a PDF. header=' + header);
  }
}

// ----------------------
// MAIN: Generate Quote PDF
// ----------------------
app.post('/generate-quote', async (req, res) => {
  let page = null;

  try {
    const data = req.body || {};
    const reqId = Date.now().toString() + '-' + Math.floor(Math.random() * 100000).toString();
    console.log(`[${reqId}] /generate-quote request received`);

    // Template (senin dosya adın manager_report.hbs — burada aynen bırakıyorum)
    const templatePath = path.join(__dirname, 'views', 'manager_report.hbs');

    if (!fs.existsSync(templatePath)) {
      console.error(`[${reqId}] Template missing:`, templatePath);
      return res.status(500).json({ error: 'Template file not found on server.', templatePath });
    }

    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    const template = hbs.compile(templateHtml, { noEscape: true });
    const finalHtml = template(data);

    // Browser + Page
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();

    // Render için daha stabil ayarlar
    await page.setViewport({ width: 1280, height: 720 });

    // Bazı ortamlarda font/asset yüklemeleri uzarsa takılmasın
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    // HTML set
    await page.setContent(finalHtml, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // network idle beklemesi: fail olursa devam et (typekit vb.)
    try {
      // Puppeteer v24+ mevcut
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 60000 });
    } catch (e) {
      console.log(`[${reqId}] waitForNetworkIdle skipped:`, e.message);
    }

    // PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    // Page kapat
    await safeClosePage(page);
    page = null;

    // PDF gerçekten PDF mi?
    assertPdfBuffer(pdfBuffer);

    // Base64
    const pdfBase64 = pdfBuffer.toString('base64');

    console.log(`[${reqId}] PDF OK bytes=${pdfBuffer.length} base64len=${pdfBase64.length}`);

    return res.status(200).json({
      status: 'Success',
      base64: pdfBase64,
      bytes: pdfBuffer.length
    });

  } catch (error) {
    console.error('Generate Quote PDF Error:', error);

    await safeClosePage(page);

    // JSON dön (Apex daha sağlıklı okur)
    return res.status(500).json({
      error: 'PDF oluşturulurken hata',
      message: error && error.message ? error.message : String(error)
    });
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
