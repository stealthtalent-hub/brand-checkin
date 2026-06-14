const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-4-8';

// The shape we ask the model to return. Kept in one place so the prompt and the
// front-end renderer stay in sync.
const OUTPUT_SHAPE = `{
  "company": "string — the product/company being pitched, as you understand it",
  "oneLiner": "string — a crisp one-sentence description of what it does and for whom",
  "market": "string — the category/market it competes in",
  "competitors": [
    {
      "name": "string — competitor company or product name",
      "url": "string — primary website if known, else empty string",
      "positioning": "string — how this competitor positions itself",
      "strengths": ["string — what they do well"],
      "weaknesses": ["string — gaps or vulnerabilities"]
    }
  ],
  "checklist": [
    {
      "category": "string — e.g. Product, Pricing, GTM, Moat, Team, Traction",
      "item": "string — the specific thing to evaluate vs. competitors",
      "why": "string — why it matters for winning / investability"
    }
  ],
  "positioning": [
    {
      "angle": "string — a differentiated positioning angle to own",
      "rationale": "string — why this is open / winnable given the competitive set"
    }
  ],
  "winningFeatures": [
    {
      "feature": "string — a feature or capability that would beat the market",
      "rationale": "string — the gap it exploits",
      "impact": "High | Medium | Low"
    }
  ],
  "investability": [
    {
      "suggestion": "string — a concrete move to make the concept more investable",
      "rationale": "string — the investor concern it addresses"
    }
  ]
}`;

const SYSTEM = `You are a sharp startup strategist and venture analyst. You help founders pressure-test a product concept against the market.

Given a pitch (as text and/or an uploaded pitch deck), you:
1. Identify exactly what the product is, who it's for, and the market it plays in.
2. Use web search to find the FIVE biggest / most relevant competitors that are actually in market today. Prefer real, currently-operating companies over generic categories. Verify they exist and are relevant before listing them.
3. Build a competitive-analysis checklist the founder can work through to position against those competitors.
4. Recommend differentiated positioning angles and features that could beat the incumbents.
5. Suggest concrete changes that make the concept more investable (de-risking, moat, traction, market size, GTM).

Be specific and grounded. Cite real competitor names and real gaps — no filler. Exactly five competitors.

Return your final answer as a single valid JSON object and NOTHING else (no prose, no markdown fences). It must match this shape exactly:
${OUTPUT_SHAPE}`;

function buildUserText(pitch, hasDeck) {
  const parts = [];
  if (hasDeck) {
    parts.push('A pitch deck is attached. Read it carefully to understand the product.');
  }
  if (pitch) {
    parts.push(`Founder's pitch:\n"""\n${pitch}\n"""`);
  }
  parts.push('Find the 5 biggest competitors, then produce the competitive analysis, positioning, winning features, and investability suggestions. Return only the JSON object.');
  return parts.join('\n\n');
}

// Pull the JSON object out of the model's final text, tolerating stray prose or
// code fences if the model adds them despite instructions.
function extractJson(text) {
  if (!text) throw new Error('Empty response from model.');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response.');
  }
  return JSON.parse(t.slice(start, end + 1));
}

async function analyze({ pitch, deck }) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const userContent = [];
  if (deck) {
    userContent.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: deck.toString('base64') }
    });
  }
  userContent.push({ type: 'text', text: buildUserText(pitch, !!deck) });

  const tools = [{ type: 'web_search_20260209', name: 'web_search' }];
  const messages = [{ role: 'user', content: userContent }];

  // Server-side web search can pause at the iteration limit (stop_reason
  // "pause_turn"); re-send to let the server resume. Cap continuations.
  let finalText = '';
  for (let i = 0; i < 6; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: SYSTEM,
      tools,
      messages
    });

    const msg = await stream.finalMessage();

    if (msg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: msg.content });
      continue;
    }

    finalText = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    break;
  }

  return extractJson(finalText);
}

module.exports = { analyze };
