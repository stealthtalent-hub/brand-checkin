const { CATEGORIES, BY_KEY } = require('./template');

// Turns the AI classification into a structured report: per-category file
// counts, a prioritized gap list, and the consolidated "information we need"
// request for the founder. Adds a deterministic safety net — any category that
// received no files at all is surfaced as a critical gap even if the model
// didn't list every missing item.

function buildAnalysis(classification, files, companyName) {
  const { assignments = [], gaps = [], summary = '' } = classification;

  // Tally files per category from the assignments.
  const counts = {};
  for (const c of CATEGORIES) counts[c.key] = 0;
  counts.UNSORTED = 0;

  const placed = [];
  for (const a of assignments) {
    const file = files[a.fileIndex];
    if (!file) continue;
    if (counts[a.category] === undefined) counts[a.category] = 0;
    counts[a.category] += 1;
    placed.push({ ...a, file });
  }

  // Per-category breakdown for the report.
  const categories = CATEGORIES.map((c) => ({
    key: c.key,
    title: c.title,
    folder: c.folder,
    description: c.description,
    fileCount: counts[c.key] || 0
  }));

  // Merge model gaps with empty-category gaps (deduped by category+item).
  const gapList = [...gaps];
  const seen = new Set(gaps.map((g) => `${g.category}::${g.item.toLowerCase()}`));
  for (const c of CATEGORIES) {
    if ((counts[c.key] || 0) === 0) {
      const item = `No documents found for ${c.title}`;
      const key = `${c.key}::${item.toLowerCase()}`;
      if (!seen.has(key)) {
        gapList.push({
          category: c.key,
          item,
          importance: 'critical',
          whatToProvide: `Provide the core ${c.title} documents (e.g. ${c.expected[0]}).`
        });
        seen.add(key);
      }
    }
  }

  // Sort gaps by importance for presentation.
  const rank = { critical: 0, important: 1, nice_to_have: 2 };
  gapList.sort((a, b) => (rank[a.importance] ?? 3) - (rank[b.importance] ?? 3));

  const stats = {
    totalFiles: files.length,
    placedFiles: placed.filter((p) => p.category !== 'UNSORTED').length,
    unsortedFiles: counts.UNSORTED || 0,
    categoriesWithContent: categories.filter((c) => c.fileCount > 0).length,
    totalCategories: CATEGORIES.length,
    criticalGaps: gapList.filter((g) => g.importance === 'critical').length
  };

  return {
    companyName: companyName || 'Company',
    generatedAt: new Date().toISOString(),
    summary,
    stats,
    categories,
    gaps: gapList,
    placed
  };
}

// Builds the styled blocks for the in-Drive "Data Room Index" Google Doc.
function buildIndexDocBlocks(analysis, dataRoomUrl) {
  const blocks = [];
  blocks.push({ style: 'TITLE', text: `${analysis.companyName} — Data Room` });
  blocks.push({
    style: 'SUBTITLE',
    text: `Prepared ${new Date(analysis.generatedAt).toLocaleDateString()} • VC due-diligence structure`
  });

  if (analysis.summary) {
    blocks.push({ style: 'HEADING_1', text: 'Executive Summary' });
    blocks.push({ style: 'NORMAL_TEXT', text: analysis.summary });
  }

  blocks.push({ style: 'HEADING_1', text: 'Readiness at a Glance' });
  blocks.push({
    style: 'NORMAL_TEXT',
    text:
      `${analysis.stats.placedFiles} of ${analysis.stats.totalFiles} files organized across ` +
      `${analysis.stats.categoriesWithContent} of ${analysis.stats.totalCategories} sections. ` +
      `${analysis.stats.criticalGaps} critical gap(s) to address.`
  });

  blocks.push({ style: 'HEADING_1', text: 'Contents' });
  for (const c of analysis.categories) {
    blocks.push({ style: 'HEADING_2', text: `${c.folder.replace(/_/g, ' ')} — ${c.fileCount} file(s)` });
    blocks.push({ style: 'NORMAL_TEXT', text: c.description });
  }

  if (analysis.gaps.length) {
    blocks.push({ style: 'HEADING_1', text: 'Information Still Needed' });
    for (const g of analysis.gaps) {
      const cat = BY_KEY[g.category] ? BY_KEY[g.category].title : g.category;
      blocks.push({
        style: 'HEADING_2',
        text: `[${g.importance.replace('_', ' ').toUpperCase()}] ${cat}: ${g.item}`
      });
      blocks.push({ style: 'NORMAL_TEXT', text: g.whatToProvide });
    }
  }

  return blocks;
}

module.exports = { buildAnalysis, buildIndexDocBlocks };
