const express = require('express');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');
const hbs = require('handlebars');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx'); 
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const ImageModule = require("docxtemplater-image-module-free");

const app = express();
// Büyük resimler için limit
app.use(bodyParser.json({ limit: '50mb' })); 

// --- ÖNEMLİ: HANDLEBARS HELPER ---
// HTML içinde {{#if (eq a b)}} kullanabilmek için bunu ekliyoruz.
hbs.registerHelper('eq', function (a, b) {
    return a === b;
});

// Uptime Kontrolü
app.get('/', (req, res) => {
    res.send('AGT PDF Servisi Aktif! 🚀 (Manager Report & Teklif)');
});

// GLOBAL TARAYICI (Performans için)
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

// --- 1. YENİ ENDPOINT: MANAGER REPORT İÇİN ---
app.post('/generate-manager-report', async (req, res) => {
    let page = null;
    try {
        const data = req.body; // Salesforce'tan gelen JSON
        console.log("Manager Report isteği geldi...");

        // 1. Şablonu Oku (views klasöründe manager_report.hbs olmalı)
        // Eğer dosya uzantısını .html yaptıysan aşağıyı değiştir.
        const templatePath = path.join(__dirname, 'views', 'manager_report.hbs'); 
        
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Şablon bulunamadı: ${templatePath}. Lütfen 'views' klasörünü kontrol et.`);
        }

        const templateHtml = fs.readFileSync(templatePath, 'utf8');

        // 2. Veriyi HTML ile Birleştir
        const template = hbs.compile(templateHtml);
        const finalHtml = template(data);

        // 3. PDF Oluştur
        const browserInstance = await getBrowser();
        page = await browserInstance.newPage();

        // HTML'i yükle
        await page.setContent(finalHtml, { 
            waitUntil: 'networkidle0', // Resimlerin tam yüklenmesini bekle
            timeout: 60000 
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true, // Yatay sayfa
            printBackground: true, // Arka plan resimleri için şart
            margin: { top: '0', right: '0', bottom: '0', left: '0' }
        });

        await page.close();

        // 4. Cevap Dön
        const pdfBase64 = pdfBuffer.toString('base64');
        res.json({ status: 'Success', base64: pdfBase64 });

    } catch (error) {
        console.error("Manager Report Hatası:", error);
        if (page) await page.close().catch(() => {});
        res.status(500).json({ error: error.message });
    }
});


// --- 2. ESKİ ENDPOINT: TEKLİF (EXCEL) İÇİN ---
// (Eski kodlarını korudum, istersen kullanabilirsin)
function parseExcelData(base64Data, label) {
    if (!base64Data) return null;
    try {
        const workbook = xlsx.read(base64Data, { type: 'base64' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        let rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        rows = rows.filter(row => row.length > 0);
        return rows;
    } catch (e) {
        console.error(`${label} Excel hatası:`, e.message);
        return null;
    }
}

app.post('/generate', async (req, res) => {
    let page = null;
    try {
        const { data } = req.body;
        
        // Excel İşlemleri
        const excelRows = parseExcelData(data.excelBase64, "Kapsam");
        const tpExcelRows = parseExcelData(data.tpExcelBase64, "TP Document");
        const teamExcelRows = parseExcelData(data.teamExcelBase64, "Team Document");

        const templateData = { ...data, excelRows, tpExcelRows, teamExcelRows };

        // Şablon Yolu (templates klasöründe teklif.html olmalı)
        const templatePath = path.resolve('./templates/teklif.html');
        const templateHtml = fs.readFileSync(templatePath, 'utf8');
        const template = hbs.compile(templateHtml);
        const finalHtml = template(templateData);

        const browserInstance = await getBrowser();
        page = await browserInstance.newPage();
        await page.setContent(finalHtml, { waitUntil: 'domcontentloaded' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' }
        });

        await page.close();
        res.json({ status: 'Success', base64: pdfBuffer.toString('base64') });

    } catch (error) {
        console.error("Teklif PDF Hatası:", error);
        if (page) await page.close().catch(() => {});
        res.status(500).json({ error: error.message });
    }
});

// --- PPTX OLUŞTURMA (Aynen Korundu) ---
app.post('/create-pptx', (req, res) => {
    // ... PPTX kodların aynı kalabilir ...
    // Sadece yer kaplamasın diye buraya tekrar yapıştırmadım, 
    // eski kodundaki create-pptx bloğunu buraya koyabilirsin.
    try {
        const data = req.body; 
        const imageOpts = {
            centered: false,
            getImage: (tagValue) => Buffer.from(tagValue, "base64"),
            getSize: () => [150, 150]
        };
        const imageModule = new ImageModule(imageOpts);
        const content = fs.readFileSync(path.resolve(__dirname, "template.pptx"), "binary");
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, { modules: [imageModule] });
        doc.render(data);
        const buf = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
        res.json({ status: 'success', fileContent: buf.toString('base64'), fileName: 'Teklif.pptx' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor!`);
    await getBrowser();
});