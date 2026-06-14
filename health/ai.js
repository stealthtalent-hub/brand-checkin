const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.HEALTH_MODEL || 'claude-opus-4-8';
const CHAT_MODEL = process.env.HEALTH_CHAT_MODEL || 'claude-opus-4-8';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY is not set on the server.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!client) client = new Anthropic();
  return client;
}

// JSON schema constraining the chat/photo extraction.
const LOG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: {
      type: 'string',
      description: 'Short, friendly confirmation of what you logged, or a question if the input was ambiguous. One or two sentences.',
    },
    logs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['food', 'drink', 'water', 'weight', 'none'] },
          description: { type: 'string' },
          calories: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          water_oz: { type: 'number' },
          weight_lb: { type: 'number' },
        },
        required: ['kind', 'description'],
      },
    },
  },
  required: ['reply', 'logs'],
};

const LOG_SYSTEM = `You are the logging engine for a personal health app. The user tells you what they ate or drank (in chat or via a photo), logs water, or reports their body weight. Units are US/imperial (fluid ounces, pounds).

Your job: turn the message into structured log entries and a brief reply.

Rules:
- For food and caloric drinks, return kind "food" (or "drink" for caloric beverages) with a realistic calorie and macro estimate (protein_g, carbs_g, fat_g). Base estimates on standard nutrition data and typical portion sizes. If a photo is provided, estimate portion size from what is visible. Create one entry per distinct item.
- For plain water (or other zero-calorie hydration like black coffee, plain tea, sparkling water), return kind "water" with water_oz. Convert cups/bottles/glasses to fluid ounces (1 cup = 8 oz, typical bottle = 16.9 oz, glass ≈ 8 oz).
- For body weight, return kind "weight" with weight_lb. Convert kg to lb if needed (1 kg = 2.205 lb).
- If the user is just chatting or asking a question (not logging), return a single entry with kind "none" and answer briefly in reply. Keep health advice evidence-based; do not invent specifics.
- Be decisive with estimates rather than asking, unless the item is truly unidentifiable. Note in the reply that figures are estimates.
- Keep the reply concise and natural — like a quick text back.`;

async function logFromChat({ message, imageBase64, imageMediaType }) {
  const c = getClient();
  const content = [];
  if (imageBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: imageMediaType || 'image/jpeg', data: imageBase64 },
    });
  }
  content.push({ type: 'text', text: message || 'Estimate the food and nutrition in this photo.' });

  const resp = await c.messages.create({
    model: CHAT_MODEL,
    max_tokens: 1200,
    system: LOG_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: LOG_SCHEMA }, effort: 'low' },
    messages: [{ role: 'user', content }],
  });

  const text = resp.content.find(b => b.type === 'text');
  let parsed;
  try {
    parsed = JSON.parse(text ? text.text : '{}');
  } catch (e) {
    parsed = { reply: "I couldn't read that — try describing it in a few words.", logs: [] };
  }
  if (!Array.isArray(parsed.logs)) parsed.logs = [];
  return parsed;
}

const REVIEW_SYSTEM = `You are a sharp, no-nonsense physician-scientist writing a private daily health briefing for one person. Your hallmark is brutal honesty grounded strictly in well-established science — randomized trials, large cohort studies, and major clinical guidelines (e.g. AASM for sleep, the US Physical Activity Guidelines, Dietary Guidelines, ACSM, AHA). You ignore wellness-industry noise: detoxes, cleanses, "boosting metabolism," alkaline/celery/charcoal fads, megadosed supplements without deficiency, adrenal-fatigue talk, and the "8 glasses of water" myth. If something is popular but not supported by good evidence, say so or leave it out.

Anchor your judgments in concrete reference points where relevant, for example:
- Adults need 7-9 hours of sleep (AASM/Sleep Research Society). Chronic short sleep raises cardiometabolic and mortality risk.
- Aim for ≥150 min/week moderate or ≥75 min vigorous aerobic activity, plus resistance training ≥2 days/week (Physical Activity Guidelines).
- Protein roughly 1.2-1.6 g/kg/day (≈0.7 g/lb) supports muscle maintenance for active adults; higher end if training or older.
- Fiber ~25-38 g/day; keep added sugar under ~10% of calories; limit alcohol (less is better, no protective threshold).
- Resting heart rate and HRV are useful recovery/fitness signals; a rising RHR or falling HRV vs the person's baseline suggests under-recovery, illness, or stress.

You will receive a JSON snapshot of today's metrics plus 7-day averages and weight trend. Write the briefing.

Output format (Markdown, tight, no preamble):
1. A one-line bold verdict on how they're doing.
2. **Today's focus:** ONE thing to prioritize today (sleep, diet, exercise, recovery, etc.), chosen from where the data is weakest, with the reason.
3. **Do this:** 2-4 specific, concrete actions for today tied to their numbers.
4. Brief honest notes on Sleep, Diet, and Exercise (one or two sentences each, using their actual numbers).

Rules:
- Use their real numbers. Quote them.
- If data is missing (e.g. no Apple Health sync yet, or no food logged), say so plainly and tell them to fix it — don't fabricate.
- Be direct and specific, not mean for its own sake. No hedging filler, no horoscope vagueness, no emoji.
- Keep it under ~250 words.`;

async function generateReview(context) {
  const c = getClient();
  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: 1600,
    system: REVIEW_SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{
      role: 'user',
      content: `Today is ${context.date}. Here is the health data snapshot:\n\n${JSON.stringify(context, null, 2)}\n\nWrite today's briefing.`,
    }],
  });
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return text || 'No briefing could be generated.';
}

module.exports = { logFromChat, generateReview, MODEL, CHAT_MODEL };
