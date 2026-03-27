const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'deals.json');

// Ensure data file exists
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
