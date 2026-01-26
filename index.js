const express = require('express');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');
const hbs = require('handlebars');
const fs = require('fs');
const path = require('path');
// Eğer excel kütüphaneleri yoksa silebilirsin ama varsa kalsın
// const xlsx = require('xlsx'); 
// const PizZip = require("pizzip");
// const Docxtemplater = require("docxtemplater");
// const ImageModule = require("docxtemplater-image-module-free");

const app = express();
app.use(bodyParser.json({ limit: '50mb' })); 

// --- ÖNEMLİ: HANDLEBARS HELPER ---
hbs.registerHelper('eq', function (a, b) {
    return a === b;
});

// Uptime Kontrolü
app.get('/', (req, res) => {
    res.send('AGT PDF Servisi Aktif! 🚀');
});

// GLOBAL TARAYICI
let browser;

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        console.log("Tarayıcı başlatılıyor...");
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

// --- İŞTE BU KISIM EKSİK OLABİLİR ---
// --- MANAGER REPORT ENDPOINT ---
app.post('/generate-quote', async (req, res) => {
    let page = null;
    try {
        const data = req.body; 
        console.log("Manager Report isteği geldi...");

        // 1. Şablonu Oku (views klasöründe manager_report.hbs olmalı)
        const templatePath = path.join(__dirname, 'views', 'manager_report.hbs');
        
        if (!fs.existsSync(templatePath)) {
            // Hata ayıklama için: dosya yoksa basit bir HTML ile dene
            console.error("Şablon bulunamadı:", templatePath);
            return res.status(500).json({ error: "Şablon dosyası sunucuda bulunamadı." });
        }

        const templateHtml = fs.readFileSync(templatePath, 'utf8');

        // 2. Veriyi HTML ile Birleştir
        const template = hbs.compile(templateHtml);
        const finalHtml = template(data);

        // 3. PDF Oluştur
        const browserInstance = await getBrowser();
        page = await browserInstance.newPage();

        await page.setContent(finalHtml, { 
            waitUntil: 'networkidle0', 
            timeout: 60000 
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true, 
            margin: { top: '0', right: '0', bottom: '0', left: '0' }
        });

        await page.close();

        // 4. Cevap Dön (Base64)
        const pdfBase64 = pdfBuffer.toString('base64');
        res.json({ status: 'Success', base64: pdfBase64 });

    } catch (error) {
        console.error("Manager Report Hatası:", error);
        if (page) await page.close().catch(() => {});
        res.status(500).send('PDF oluşturulurken hata: ' + error.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor!`);
    await getBrowser();
});