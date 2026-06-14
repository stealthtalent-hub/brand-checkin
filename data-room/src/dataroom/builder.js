const { CATEGORIES, UNSORTED, START_HERE, BY_KEY } = require('./template');
const { buildIndexDocBlocks } = require('./gapReport');

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
}

// Resolve a model-provided subfolder name to a canonical subfolder for the
// category, or null to place the file in the category root.
function resolveSubfolder(categoryKey, subfolderName) {
  const cat = BY_KEY[categoryKey];
  if (!cat || !cat.subfolders || !subfolderName) return null;
  const target = normalize(subfolderName);
  return cat.subfolders.find((s) => normalize(s) === target) || null;
}

// Creates the full data-room folder tree in Drive, copies the categorized files
// into place (non-destructively), generates the index document, and returns a
// build summary. `analysis` comes from gapReport.buildAnalysis.
async function buildDataRoom(driveService, analysis, dataRoomUrlPlaceholder) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const rootName = `${analysis.companyName} — Data Room (${dateStr})`;

  const root = await driveService.createFolder(rootName, null);

  // Cache of created folders: key -> {id}. Keys: category key, or `${cat}/${sub}`.
  const folderCache = {};

  // Always create Start Here + every category folder so the structure is
  // complete and best-practice even where content is missing.
  const startHere = await driveService.createFolder(START_HERE.folder, root.id);

  for (const c of CATEGORIES) {
    const folder = await driveService.createFolder(c.folder, root.id);
    folderCache[c.key] = folder.id;
  }

  async function ensureSubfolder(categoryKey, sub) {
    const cacheKey = `${categoryKey}/${sub}`;
    if (folderCache[cacheKey]) return folderCache[cacheKey];
    const cat = BY_KEY[categoryKey];
    const folder = await driveService.createFolder(sub, folderCache[categoryKey]);
    folderCache[cacheKey] = folder.id;
    return folder.id;
  }

  // Copy files into place.
  let copied = 0;
  const errors = [];
  let unsortedFolderId = null;

  for (const p of analysis.placed) {
    try {
      let destId;
      if (p.category === 'UNSORTED') {
        if (!unsortedFolderId) {
          const f = await driveService.createFolder(UNSORTED.folder, root.id);
          unsortedFolderId = f.id;
        }
        destId = unsortedFolderId;
      } else {
        destId = folderCache[p.category];
        const sub = resolveSubfolder(p.category, p.subfolder);
        if (sub) destId = await ensureSubfolder(p.category, sub);
      }
      await driveService.copyFile(p.file.id, destId, p.file.name);
      copied += 1;
    } catch (err) {
      errors.push({ file: p.file.path, error: err.message });
    }
  }

  // Generate the professionally formatted index document.
  let indexDoc = null;
  try {
    const blocks = buildIndexDocBlocks(analysis, root.webViewLink);
    indexDoc = await driveService.createFormattedDoc(
      `${analysis.companyName} — Data Room Index`,
      blocks,
      startHere.id
    );
  } catch (err) {
    errors.push({ file: 'Data Room Index', error: err.message });
  }

  return {
    rootFolder: root,
    indexDoc,
    copiedCount: copied,
    errors
  };
}

module.exports = { buildDataRoom };
