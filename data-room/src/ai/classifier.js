const { getClient, MODEL } = require('./anthropicClient');
const { CATEGORIES, CATEGORY_KEYS } = require('../dataroom/template');

// Asks Claude to map every file in the linked Drive folder to the correct
// data-room category + subfolder, and to identify what's missing relative to a
// VC due-diligence checklist. Files are referenced by integer index (not their
// long Drive IDs) to keep the prompt compact.

const SYSTEM_PROMPT = `You are a meticulous venture-capital diligence analyst preparing a startup's data room.
You organize a company's raw documents into a clean, best-practice fundraising data room and identify exactly what is missing.
Be precise and conservative: only place a file in a category when the filename (and path) clearly support it. When unsure, use "UNSORTED".
Judge gaps against the provided checklist for each category, taking into account what files are actually present.`;

function buildCategoryReference() {
  return CATEGORIES.map((c) => {
    const subs = c.subfolders.join(', ');
    const expected = c.expected.map((e) => `      - ${e}`).join('\n');
    return `- ${c.key} — ${c.title}: ${c.description}\n    Subfolders: ${subs}\n    Expected documents:\n${expected}`;
  }).join('\n');
}

function buildInventory(files) {
  return files
    .map((f, i) => {
      const size = f.size ? ` (${Math.round(f.size / 1024)} KB)` : '';
      return `${i}. ${f.path} [${f.mimeType}]${size}`;
    })
    .join('\n');
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assignments: {
      type: 'array',
      description: 'One entry per input file, referenced by its index.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fileIndex: { type: 'integer' },
          category: { type: 'string', enum: [...CATEGORY_KEYS, 'UNSORTED'] },
          subfolder: {
            type: 'string',
            description: 'Best-fitting subfolder name from the category, or "" for the category root.'
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          rationale: { type: 'string' }
        },
        required: ['fileIndex', 'category', 'subfolder', 'confidence', 'rationale']
      }
    },
    gaps: {
      type: 'array',
      description: 'Missing or incomplete diligence items the company should provide.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', enum: CATEGORY_KEYS },
          item: { type: 'string', description: 'The specific missing document or information.' },
          importance: { type: 'string', enum: ['critical', 'important', 'nice_to_have'] },
          whatToProvide: { type: 'string', description: 'A short, actionable request to the founder.' }
        },
        required: ['category', 'item', 'importance', 'whatToProvide']
      }
    },
    summary: {
      type: 'string',
      description: 'A 2-4 sentence executive summary of the data room readiness.'
    }
  },
  required: ['assignments', 'gaps', 'summary']
};

async function classifyFiles(files, companyName) {
  const client = getClient();

  const userPrompt = `Company: ${companyName || 'Unknown'}

DATA ROOM CATEGORIES (target structure):
${buildCategoryReference()}

FILES FOUND IN THE LINKED GOOGLE DRIVE FOLDER (${files.length} total), as "index. path [mimeType]":
${buildInventory(files)}

Tasks:
1. Assign EVERY file (by its index) to the single best category and a subfolder within it. Use "UNSORTED" with an empty subfolder when a file does not belong in an investor data room or is too ambiguous to place.
2. Identify the gaps: documents/information expected for a fundraise that are missing or appear incomplete given the files present. Prioritize each as critical, important, or nice_to_have.
3. Write a short executive summary of how investor-ready this data room is.

Return only the structured object.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }]
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to process this request.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Classification output was truncated. Try a folder with fewer files.');
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No structured output returned from the model.');

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    throw new Error(`Failed to parse model output: ${err.message}`);
  }
  return parsed;
}

module.exports = { classifyFiles };
