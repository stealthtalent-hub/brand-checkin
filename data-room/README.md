# Data Room Builder

Link a company's Google Drive folder and let AI assemble a best-practice **VC
due-diligence data room** from the files inside it — then get a report of exactly
what's still missing. Originals are **copied, never moved or modified**.

What it does:

1. **Scans** the linked Drive folder recursively.
2. **Classifies** every file into a best-practice fundraising data-room structure
   (Corporate, Cap Table, Financials, Legal, IP, Team, Product, Market, Traction,
   Fundraising) using Claude.
3. **Builds** the clean folder tree in Drive and copies each file into place.
4. **Reports** the gaps — the documents and information investors will expect that
   aren't there yet — prioritized as critical / important / nice-to-have, and emails
   the report.
5. **Formats** a professional in-Drive *Data Room Index* document, and can reformat
   individual Google Docs into clean, structured versions.

## Architecture

```
src/
  server.js              Express app + static hosting
  config.js              Env + OAuth/scope configuration
  store.js               JSON persistence (tokens, reports)
  drive/
    auth.js              Google OAuth2 flow + token refresh
    driveService.js      Drive + Docs API wrapper (scan, create, copy, format)
  ai/
    anthropicClient.js   Anthropic SDK client
    classifier.js        File → category mapping + gap analysis (structured output)
    formatter.js         Document reformatting (structured output)
  dataroom/
    template.js          The VC due-diligence structure + diligence checklists
    gapReport.js         Builds the analysis + index-doc blocks
    builder.js           Creates folders, copies files, writes the index doc
  report/
    reportRenderer.js    HTML report (preview + email)
    emailer.js           Nodemailer delivery
  routes/
    auth.js              /auth/google, callback, disconnect
    dataroom.js          /api/status, /api/analyze, /api/format-document
public/                  Single-page UI
```

## Setup

1. **Google Cloud**: create an OAuth 2.0 *Web application* client, enable the
   **Google Drive API** and **Google Docs API**, and add the redirect URI
   `http://localhost:4000/auth/google/callback` (match `APP_BASE_URL`).
2. **Anthropic**: get an API key from the Anthropic Console.
3. Copy `.env.example` to `.env` and fill in the values.
4. Install and run:

   ```bash
   npm install
   npm start
   ```

5. Open `http://localhost:4000`, connect Google Drive, paste a folder link, and
   click **Analyze & Build**. Use **Preview only** to see the plan and gap report
   without creating anything in Drive first.

## Notes

- **Non-destructive**: the tool only reads and copies. Your source folder is left
  untouched; the data room is created as a new top-level folder in your Drive.
- **Model**: defaults to `claude-opus-4-8`. Override with `ANTHROPIC_MODEL`.
- **Scopes**: full Drive access is required to read and copy arbitrary existing
  files; Docs access is used to generate the formatted index document.
- This is a single-account tool — one connected Google account at a time, with
  tokens stored locally in `data/tokens.json` (gitignored).
