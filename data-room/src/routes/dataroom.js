const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const auth = require('../drive/auth');
const { DriveService, GOOGLE_DOC_MIME } = require('../drive/driveService');
const { classifyFiles } = require('../ai/classifier');
const { formatDocumentText } = require('../ai/formatter');
const { buildAnalysis } = require('../dataroom/gapReport');
const { buildDataRoom } = require('../dataroom/builder');
const { renderReportHtml } = require('../report/reportRenderer');
const emailer = require('../report/emailer');
const store = require('../store');

function requireDrive(res) {
  const client = auth.getAuthorizedClient();
  if (!client) {
    res.status(401).json({ error: 'Not connected to Google Drive. Connect first.' });
    return null;
  }
  return new DriveService(client);
}

// Connection + capability status for the UI.
router.get('/status', async (req, res) => {
  const client = auth.getAuthorizedClient();
  const connected = Boolean(client);
  let email = null;
  if (connected) email = await auth.getConnectedEmail(client);
  res.json({
    connected,
    email,
    emailConfigured: emailer.isConfigured()
  });
});

// Main pipeline: scan → classify → (build) → report → (email).
router.post('/analyze', async (req, res) => {
  const drive = requireDrive(res);
  if (!drive) return;

  const { folderUrl, companyName, recipientEmail, dryRun } = req.body || {};
  const folderId = DriveService.parseFolderId(folderUrl);
  if (!folderId) {
    return res.status(400).json({ error: 'Could not read a Drive folder ID from that input.' });
  }

  try {
    // 1. Verify access and scan the folder tree.
    const folderMeta = await drive.getFile(folderId);
    const files = await drive.listFolderTree(folderId);
    if (files.length === 0) {
      return res.status(400).json({ error: 'That folder appears to be empty (or inaccessible).' });
    }

    // 2. AI classification + gap analysis.
    const classification = await classifyFiles(files, companyName);
    const analysis = buildAnalysis(classification, files, companyName);

    // 3. Build the data room in Drive (unless this is a dry run / preview).
    let build = null;
    if (!dryRun) {
      build = await buildDataRoom(drive, analysis);
    }

    // 4. Render the report and (optionally) email it.
    const reportHtml = renderReportHtml(analysis, build);
    let emailed = false;
    if (recipientEmail && emailer.isConfigured()) {
      try {
        await emailer.sendReport(
          recipientEmail,
          `${analysis.companyName} — Data Room Report`,
          reportHtml
        );
        emailed = true;
      } catch (err) {
        console.error('Email failed:', err.message);
      }
    }

    // 5. Persist and respond.
    const id = crypto.randomBytes(8).toString('hex');
    const record = { id, analysis, build, sourceFolder: folderMeta, emailed };
    store.saveReport(id, record);

    res.json({
      id,
      dryRun: Boolean(dryRun),
      emailed,
      analysis,
      build,
      reportHtml
    });
  } catch (err) {
    console.error('Analyze failed:', err);
    res.status(500).json({ error: err.message || 'Pipeline failed.' });
  }
});

// Reformat a single Google Doc into a new, professionally structured doc.
router.post('/format-document', async (req, res) => {
  const drive = requireDrive(res);
  if (!drive) return;

  const { fileId, destFolderId } = req.body || {};
  if (!fileId) return res.status(400).json({ error: 'fileId is required.' });

  try {
    const meta = await drive.getFile(fileId);
    if (meta.mimeType !== GOOGLE_DOC_MIME) {
      return res
        .status(400)
        .json({ error: 'Only Google Docs can be reformatted in place.' });
    }
    const rawText = await drive.exportDocText(fileId);
    const blocks = await formatDocumentText(meta.name, rawText);
    const newDoc = await drive.createFormattedDoc(
      `${meta.name} (Formatted)`,
      blocks,
      destFolderId || null
    );
    res.json({ ok: true, document: newDoc });
  } catch (err) {
    console.error('Format failed:', err);
    res.status(500).json({ error: err.message || 'Formatting failed.' });
  }
});

// Retrieve a previously generated report.
router.get('/report/:id', (req, res) => {
  const record = store.loadReport(req.params.id);
  if (!record) return res.status(404).json({ error: 'Report not found.' });
  res.json(record);
});

module.exports = router;
