const express = require('express');
const puppeteer = require('puppeteer');
const hbs = require('handlebars');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));

hbs.registerHelper('eq', (a, b) => a === b);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process'
      ]
    });
  }
  return browser;
}

// GET ile test edince "Cannot GET" görmeyesin diye:
app.get('/', (req, res) => res.send('AGT PDF Servisi Aktif! 🚀'));
app.get('/generate-quote', (req, res) => res.status(405).send('Use POST /generate-quote'));
app.get('/generate-manager-report', (req, res) => res.status(405).send('Use POST /generate-manager-report'));
app.get('/generate-quote-pdf', (req, res) => res.status(405).send('Use POST /generate-quote-pdf'));

async function renderPdfFromTemplate(data) {
  const templatePath = path.join(__dirname, 'views', 'manager_report.hbs'); // dosya adın değişmiyor
  if (!fs.existsSync(templatePath)) {
    throw new Error('Template not found: ' + templatePath);
  }

  const templateHtml = fs.readFileSync(templatePath, 'utf8');
  const template = hbs.compile(templateHtml);
  const finalHtml = template(data);

  const browserInstance = await getBrowser();
  const page = await browserInstance.newPage();

  try {
    // networkidle0 Typekit vb. yüzünden bazen hiç idle olmaz -> timeout üretir.
    await page.setContent(finalHtml, { waitUntil: 'domcontentloaded', timeout: 120000 });

    // Fontlar varsa bekle (Typekit dahil)
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
    await sleep(300); // mini buffer

    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    return pdfBuffer;
  } finally {
    await page.close().catch(() => {});
  }
}

// Aynı template ile 3 endpoint’i de destekleyelim (Salesforce hangi path’e atarsa atsın)
async function handleGenerate(req, res) {
  try {
    const data = req.body || {};
    const pdfBuffer = await renderPdfFromTemplate(data);
    res.json({ status: 'Success', base64: pdfBuffer.toString('base64') });
  } catch (e) {
    console.error('PDF ERROR:', e);
    res.status(500).send('PDF oluşturulurken hata: ' + e.message);
  }
}

app.post('/generate-quote', handleGenerate);
app.post('/generate-manager-report', handleGenerate);
app.post('/generate-quote-pdf', handleGenerate);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor!`);
  await getBrowser();
});
