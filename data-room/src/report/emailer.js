const nodemailer = require('nodemailer');
const { config } = require('../config');

function isConfigured() {
  return Boolean(config.smtp.user && config.smtp.pass);
}

async function sendReport(to, subject, html) {
  if (!isConfigured()) {
    throw new Error('Email is not configured (set SMTP_USER and SMTP_PASS).');
  }
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass }
  });

  await transporter.sendMail({
    from: `"Data Room Builder" <${config.smtp.from}>`,
    to,
    subject,
    html
  });
}

module.exports = { sendReport, isConfigured };
