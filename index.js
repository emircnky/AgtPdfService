const express = require('express');
const puppeteer = require('puppeteer');
const hbs = require('handlebars');
const fs = require('fs');
const path = require('path');

const app = express();

// Express'in kendi JSON parser'ı yeterli (body-parser şart değil)
app.use(express.json({ limit: '50mb' }));

// Helper
hbs.registerHelper('eq', function (a, b) {
  return a === b;
});

// Uptime
app.get('/', (req, res) => {
  res.send('AGT PDF Servisi Aktif! 🚀');
});

// GLOBAL TARAYICI
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
        '--single-process'
      ]
    });
  }
  return browser;
}

async function generatePdfFromTemplate(data) {
  // Template adı SENİN İSTEDİĞİN GİBİ KALDI
  const templatePath = path.join(__dirname, 'views', 'manager_report.hbs');

  if (!fs.existsSync(templatePath)) {
    throw new Error('Şablon dosyası sunucuda bulunamadı: ' + templatePath);
  }

  const templateHtml = fs.readFileSync(templatePath, 'utf8');
  const template = hbs.compile(templateHtml);
  const finalHtml = template(data);

  const browserInstance = await getBrowser();
  const page = await browserInstance.newPage();

  try {
    // Typekit gibi dış kaynaklar networkidle0'da takılabiliyor
    await page.setContent(finalHtml, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Fontların yüklenmesini kısa süre bekle (yüklenmezse de devam eder)
    await page.evaluateHandle('document.fonts && document.fonts.ready').catch(() => {});
    await page.waitForTimeout(300);

    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    return pdfBuffer;
  } finally {
    await page.close().catch(() => {});
  }
}

// Tek handler: hangi route'tan gelirse gelsin aynı PDF üret
async function handler(req, res) {
  try {
    console.log('PDF isteği geldi =>', req.method, req.path);

    const data = req.body || {};
    const pdfBuffer = await generatePdfFromTemplate(data);
    const pdfBase64 = pdfBuffer.toString('base64');

    return res.json({ status: 'Success', base64: pdfBase64 });
  } catch (error) {
    console.error('PDF Hatası:', error);
    return res.status(500).send('PDF oluşturulurken hata: ' + error.message);
  }
}

// ✅ Aynı handler birden fazla path'e bağlandı (404 biter)
const ROUTES = ['/generate-quote', '/generate-manager-report', '/generate-quote-pdf'];

// Tarayıcıdan kontrol edebil diye aynı path’lere GET koydum
app.get(ROUTES, (req, res) => res.send('OK: ' + req.path));

// Asıl PDF POST’ları
app.post(ROUTES, handler);

// En son: route yoksa daha anlaşılır 404 (Express default yerine)
app.use((req, res) => {
  res.status(404).send('Not Found: ' + req.method + ' ' + req.path);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor!`);
  await getBrowser();
});
