const { google } = require('googleapis');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

// Wraps the Drive + Docs APIs for an authorized OAuth client and exposes the
// handful of operations the data-room pipeline needs. Read/copy operations are
// non-destructive — originals are never modified or deleted.
class DriveService {
  constructor(authClient) {
    this.drive = google.drive({ version: 'v3', auth: authClient });
    this.docs = google.docs({ version: 'v1', auth: authClient });
  }

  // Accepts a raw folder ID or any Google Drive folder URL and returns the ID.
  static parseFolderId(input) {
    if (!input) return null;
    const trimmed = String(input).trim();
    const patterns = [
      /\/folders\/([a-zA-Z0-9_-]+)/, // .../folders/<id>
      /[?&]id=([a-zA-Z0-9_-]+)/ // ...open?id=<id>
    ];
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m) return m[1];
    }
    // Otherwise assume the input is already an ID.
    return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : null;
  }

  async getFile(fileId) {
    const { data } = await this.drive.files.get({
      fileId,
      fields: 'id, name, mimeType, parents, webViewLink',
      supportsAllDrives: true
    });
    return data;
  }

  // Recursively walks a folder and returns a flat list of non-folder files,
  // each annotated with its relative path inside the linked folder.
  async listFolderTree(folderId) {
    const files = [];
    const walk = async (parentId, relPath) => {
      let pageToken;
      do {
        const { data } = await this.drive.files.list({
          q: `'${parentId}' in parents and trashed = false`,
          fields:
            'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)',
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });
        for (const f of data.files || []) {
          const itemPath = relPath ? `${relPath}/${f.name}` : f.name;
          if (f.mimeType === FOLDER_MIME) {
            await walk(f.id, itemPath);
          } else {
            files.push({
              id: f.id,
              name: f.name,
              mimeType: f.mimeType,
              size: f.size ? parseInt(f.size, 10) : null,
              modifiedTime: f.modifiedTime,
              webViewLink: f.webViewLink,
              path: itemPath
            });
          }
        }
        pageToken = data.nextPageToken;
      } while (pageToken);
    };
    await walk(folderId, '');
    return files;
  }

  async createFolder(name, parentId) {
    const { data } = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME,
        parents: parentId ? [parentId] : undefined
      },
      fields: 'id, name, webViewLink',
      supportsAllDrives: true
    });
    return data;
  }

  // Copies a file into a destination folder (non-destructive).
  async copyFile(fileId, destFolderId, newName) {
    const { data } = await this.drive.files.copy({
      fileId,
      requestBody: {
        parents: [destFolderId],
        name: newName || undefined
      },
      fields: 'id, name, webViewLink',
      supportsAllDrives: true
    });
    return data;
  }

  // Extracts plain text from a Google Doc (used by the document formatter).
  async exportDocText(fileId) {
    const res = await this.drive.files.export(
      { fileId, mimeType: 'text/plain' },
      { responseType: 'text' }
    );
    return res.data;
  }

  // Creates a Google Doc from styled blocks. Each block is
  // { style: 'TITLE'|'SUBTITLE'|'HEADING_1'|'HEADING_2'|'NORMAL_TEXT', text }.
  async createFormattedDoc(title, blocks, parentId) {
    const { data: doc } = await this.docs.documents.create({
      requestBody: { title }
    });
    const documentId = doc.documentId;

    // Build the full body text, tracking each block's character range so we can
    // apply paragraph styles after a single bulk insert.
    let fullText = '';
    const ranges = [];
    for (const block of blocks) {
      const start = 1 + fullText.length; // body content starts at index 1
      const text = `${block.text}\n`;
      fullText += text;
      ranges.push({ style: block.style, start, end: start + text.length });
    }

    const requests = [{ insertText: { location: { index: 1 }, text: fullText } }];
    for (const r of ranges) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          paragraphStyle: { namedStyleType: r.style },
          fields: 'namedStyleType'
        }
      });
    }
    await this.docs.documents.batchUpdate({
      documentId,
      requestBody: { requests }
    });

    // Move the new doc into the target folder (it is created in My Drive root).
    if (parentId) {
      await this.drive.files.update({
        fileId: documentId,
        addParents: parentId,
        fields: 'id, parents',
        supportsAllDrives: true
      });
    }

    const meta = await this.getFile(documentId);
    return meta;
  }
}

module.exports = { DriveService, FOLDER_MIME, GOOGLE_DOC_MIME };
