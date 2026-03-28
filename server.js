const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'deals.json');

// Ensure data directory and file exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function readDeals() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeDeals(deals) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(deals, null, 2));
}

// Submit a verified brand deal
app.post('/api/submit', (req, res) => {
  const { managerCode, brandName, personName, email } = req.body;

  if (!managerCode || !brandName || !personName || !email) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  if (managerCode.length !== 6) {
    return res.status(400).json({ error: 'Manager code must be exactly 6 characters.' });
  }

  const emailLower = email.toLowerCase().trim();
  const deals = readDeals();

  const existing = deals.find(d => d.email === emailLower);
  if (existing) {
    return res.status(409).json({ error: 'This email is already in the database.' });
  }

  deals.push({
    managerCode: managerCode.trim(),
    brandName: brandName.trim(),
    personName: personName.trim(),
    email: emailLower,
    submittedAt: new Date().toISOString()
  });

  writeDeals(deals);
  res.json({ success: true });
});

// Search for an email
app.get('/api/search', (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const deals = readDeals();
  const match = deals.find(d => d.email === email);

  if (match) {
    res.json({
      found: true,
      brandName: match.brandName,
      personName: match.personName,
      managerCode: match.managerCode
    });
  } else {
    res.json({ found: false });
  }
});

// Bulk CSV import
app.post('/api/bulk-submit', upload.single('csv'), (req, res) => {
  const { managerCode } = req.body;

  if (!managerCode || managerCode.trim().length !== 6) {
    return res.status(400).json({ error: 'A valid 6-character manager code is required.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'A CSV file is required.' });
  }

  const lines = req.file.buffer.toString('utf8').split('\n').map(l => l.trim()).filter(Boolean);

  if (lines.length < 2) {
    return res.status(400).json({ error: 'CSV must have a header row and at least one data row.' });
  }

  // Detect header and column indexes
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const brandIdx = header.findIndex(h => h.includes('brand'));
  const nameIdx  = header.findIndex(h => h.includes('name') || h.includes('contact') || h.includes('person'));
  const emailIdx = header.findIndex(h => h.includes('email'));

  if (brandIdx === -1 || nameIdx === -1 || emailIdx === -1) {
    return res.status(400).json({ error: 'CSV must have columns for brand, name, and email. Check the template.' });
  }

  const deals = readDeals();
  let added = 0, skipped = 0, errors = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const brandName  = cols[brandIdx] || '';
    const personName = cols[nameIdx]  || '';
    const email      = (cols[emailIdx] || '').toLowerCase();

    if (!brandName || !personName || !email || !email.includes('@')) {
      errors.push(`Row ${i + 1}: missing or invalid data`);
      skipped++;
      continue;
    }

    if (deals.find(d => d.email === email)) {
      skipped++;
      continue;
    }

    deals.push({
      managerCode: managerCode.trim(),
      brandName,
      personName,
      email,
      submittedAt: new Date().toISOString()
    });
    added++;
  }

  writeDeals(deals);
  res.json({ success: true, added, skipped, errors });
});

// Send application email
app.post('/api/apply', upload.single('roster'), async (req, res) => {
  const { name, email, phone } = req.body;

  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'Name, email, and phone are required.' });
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('SMTP not configured. Set SMTP_USER and SMTP_PASS in .env');
    return res.status(500).json({ error: 'Email service not configured on the server.' });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const attachments = [];
  if (req.file) {
    attachments.push({
      filename: req.file.originalname || 'roster.csv',
      content: req.file.buffer
    });
  }

  try {
    await transporter.sendMail({
      from: `"Brand Checkin" <${process.env.SMTP_USER}>`,
      to: 'creators@stealthtlnt.com',
      subject: `Manager Application — ${name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 500px;">
          <h2 style="margin-bottom: 20px;">New Manager Application</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phone}</p>
          ${req.file ? '<p><strong>Roster:</strong> Attached as CSV</p>' : '<p><strong>Roster:</strong> Not provided</p>'}
        </div>
      `,
      attachments
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Email send error:', err.message);
    res.status(500).json({ error: 'Failed to send application. Please try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`Brand Checkin running at http://localhost:${PORT}`);
});
