// Dependency-free smoke test: loads every module and exercises the pure logic
// (no Google/Anthropic credentials required). Exits non-zero on any failure.
const assert = require('assert');
const path = require('path');

function load(rel) {
  return require(path.join('..', rel));
}

// 1. Every module must load without throwing.
const modules = [
  'src/config', 'src/store',
  'src/drive/auth', 'src/drive/driveService',
  'src/dataroom/template', 'src/dataroom/gapReport', 'src/dataroom/builder',
  'src/ai/anthropicClient', 'src/ai/classifier', 'src/ai/formatter',
  'src/report/reportRenderer', 'src/report/emailer',
  'src/routes/auth', 'src/routes/dataroom'
];
for (const m of modules) {
  load(m);
  console.log('loaded', m);
}

// 2. Drive folder ID / URL parsing.
const { DriveService } = load('src/drive/driveService');
assert.strictEqual(
  DriveService.parseFolderId('https://drive.google.com/drive/folders/1AbC_dEf-123?usp=sharing'),
  '1AbC_dEf-123'
);
assert.strictEqual(DriveService.parseFolderId('1AbC_dEf-123'), '1AbC_dEf-123');
assert.strictEqual(DriveService.parseFolderId('not a url!!'), null);

// 3. Classification -> analysis -> report rendering with mock data.
const { buildAnalysis } = load('src/dataroom/gapReport');
const { renderReportHtml } = load('src/report/reportRenderer');

const files = [
  { id: 'f1', name: 'Cap Table.xlsx', mimeType: 'application/vnd.ms-excel', path: 'Cap Table.xlsx', size: 20480 },
  { id: 'f2', name: 'Pitch Deck.pdf', mimeType: 'application/pdf', path: 'Pitch Deck.pdf', size: 204800 },
  { id: 'f3', name: 'meme.png', mimeType: 'image/png', path: 'misc/meme.png', size: 1024 }
];
const classification = {
  summary: 'Early stage; cap table and deck present.',
  assignments: [
    { fileIndex: 0, category: 'CAP_TABLE', subfolder: 'Cap_Table', confidence: 'high', rationale: 'cap table' },
    { fileIndex: 1, category: 'FUNDRAISING', subfolder: 'Pitch_Deck', confidence: 'high', rationale: 'deck' },
    { fileIndex: 2, category: 'UNSORTED', subfolder: '', confidence: 'low', rationale: 'irrelevant' }
  ],
  gaps: [
    { category: 'LEGAL', item: 'No material contracts', importance: 'critical', whatToProvide: 'Upload key contracts.' }
  ]
};

const analysis = buildAnalysis(classification, files, 'Acme Inc.');
assert.strictEqual(analysis.stats.totalFiles, 3);
assert.strictEqual(analysis.stats.placedFiles, 2);
assert.strictEqual(analysis.stats.unsortedFiles, 1);
assert.strictEqual(analysis.stats.categoriesWithContent, 2);
assert.ok(analysis.gaps.length >= 1, 'expected at least one gap');
assert.ok(analysis.gaps.some((g) => g.category === 'LEGAL'), 'model gap should be present');

const html = renderReportHtml(analysis, { rootFolder: { webViewLink: 'https://drive.google.com/x' }, errors: [] });
assert.ok(html.includes('Acme Inc.'), 'report should include company name');
assert.ok(html.length > 1000, 'report html should be substantial');

console.log('\nSmoke test passed.');
