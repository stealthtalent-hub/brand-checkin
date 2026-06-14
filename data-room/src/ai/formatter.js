const { getClient, MODEL } = require('./anthropicClient');

// Reformats the plain text of a document into a clean, professional structure.
// Returns an array of styled blocks suitable for DriveService.createFormattedDoc.
// Non-destructive: the caller writes the result to a NEW Google Doc.

const SYSTEM_PROMPT = `You are an expert document editor for a venture-backed startup's investor data room.
You take a document's raw text and reformat it into a clean, professional structure WITHOUT inventing facts.
Rules:
- Preserve all substantive content, figures, names, and dates exactly. Do not fabricate.
- Improve clarity: fix obvious typos and spacing, organize into logical sections with clear headings.
- Use a concise, professional tone appropriate for investors.
- Do NOT add commentary, disclaimers, or content that was not in the source.`;

const BLOCKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          style: {
            type: 'string',
            enum: ['TITLE', 'SUBTITLE', 'HEADING_1', 'HEADING_2', 'NORMAL_TEXT']
          },
          text: { type: 'string' }
        },
        required: ['style', 'text']
      }
    }
  },
  required: ['blocks']
};

async function formatDocumentText(title, rawText) {
  const client = getClient();

  const userPrompt = `Document title: ${title}

Raw text of the document:
"""
${rawText}
"""

Reformat this into a professionally structured document. Begin with a TITLE block (the document title), then organize the content with headings and paragraphs. Return only the structured blocks.`;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: BLOCKS_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const response = await stream.finalMessage();

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to format this document.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No formatted output returned.');

  const parsed = JSON.parse(textBlock.text);
  return parsed.blocks;
}

module.exports = { formatDocumentText };
