/**
 * AGENT ENGINE (Gemini-powered, using the current @google/genai SDK)
 * -----------------------------------------------------------------------
 * Uses Google's current, actively-maintained SDK (@google/genai), which
 * supports the new "Auth key" format (keys starting with "AQ.") that
 * Google AI Studio now issues by default.
 *
 * Emergency detection and off-topic refusal stay as hard guards in plain
 * code - safety-critical behavior that should never depend on a model
 * call succeeding or behaving as expected.
 * -----------------------------------------------------------------------
 */

const { GoogleGenAI, Type } = require('@google/genai');
const db = require('../mock/mockDataverse');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = 'gemini-3.6-flash';

// In-memory conversation history per session (per browser tab).
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [], location: null, lastRequestNumber: null });
  }
  return sessions.get(sessionId);
}

const EMERGENCY_WORDS = ['fire', 'gas leak', 'explosion', 'shooting', 'gun', 'bleeding', 'heart attack', 'someone is trapped', 'life threatening', 'emergency'];
function detectEmergency(text) {
  const t = text.toLowerCase();
  return EMERGENCY_WORDS.some((w) => t.includes(w));
}

const OFF_TOPIC_WORDS = [
  'recipe', 'how to cook', 'how do i make', 'joke', 'funny story',
  'weather forecast', 'stock price', 'movie', 'song lyrics', 'write code',
  'write a program', 'homework', 'translate', 'poem', 'write a story',
  'sports score', 'who won the', 'capital of', 'math problem', 'solve for x',
  'calculate', 'what is the meaning of life', 'write an essay',
  'who is the president', 'what year did', 'define ', 'synonym for',
];
function detectOffTopic(text) {
  const t = text.toLowerCase();
  return OFF_TOPIC_WORDS.some((w) => t.includes(w));
}

// ---------- Tool (function) declarations Gemini can call ----------
const functionDeclarations = [
  {
    name: 'CreateServiceRequest',
    description: 'File a new 311 service request once category, subCategory, description, and a CONFIRMED address are all known. Never call this before the citizen has explicitly confirmed the address (whether auto-detected or manually given).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: { type: Type.STRING, description: 'e.g. Street, Sanitation, Parking, Noise, Parks, Street Lighting' },
        subCategory: { type: Type.STRING, description: 'e.g. Pothole, Illegal Parking, Missed Trash Collection, Noise Complaint' },
        description: { type: Type.STRING },
        address: { type: Type.STRING, description: 'The confirmed address - either the citizen-typed address, or "Lat X, Lng Y" if they confirmed the auto-detected location as-is.' },
        city: { type: Type.STRING },
        state: { type: Type.STRING },
        zipCode: { type: Type.STRING },
        latitude: { type: Type.NUMBER, description: 'Only include if the confirmed address is the auto-detected location.' },
        longitude: { type: Type.NUMBER, description: 'Only include if the confirmed address is the auto-detected location.' },
      },
      required: ['category', 'subCategory', 'description', 'address'],
    },
  },
  {
    name: 'GetServiceRequest',
    description: 'Look up a service request by its number, format REQ-000001.',
    parameters: {
      type: Type.OBJECT,
      properties: { requestNumber: { type: Type.STRING } },
      required: ['requestNumber'],
    },
  },
  {
    name: 'GetRequestHistory',
    description: 'Get the status change history/timeline for a service request.',
    parameters: {
      type: Type.OBJECT,
      properties: { requestNumber: { type: Type.STRING } },
      required: ['requestNumber'],
    },
  },
  {
    name: 'SearchServices',
    description: 'Search the list of 311 service categories by keyword.',
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING } },
      required: ['query'],
    },
  },
  {
    name: 'FindAgency',
    description: 'Find which city agency handles a given category/subCategory of issue.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: { type: Type.STRING },
        subCategory: { type: Type.STRING },
      },
      required: ['category'],
    },
  },
  {
    name: 'KnowledgeSearch',
    description: 'Search the knowledge base for answers to common questions.',
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING } },
      required: ['query'],
    },
  },
];

async function executeTool(name, args) {
  switch (name) {
    case 'CreateServiceRequest':
      return db.createServiceRequest(args);
    case 'GetServiceRequest':
      return db.getServiceRequest((args.requestNumber || '').toUpperCase());
    case 'GetRequestHistory':
      return db.getRequestHistory((args.requestNumber || '').toUpperCase());
    case 'SearchServices':
      return db.searchServices(args.query);
    case 'FindAgency': {
      const categories = await db.getServiceCategories();
      const match = categories.find(
        (c) =>
          c.categoryName.toLowerCase() === (args.category || '').toLowerCase() &&
          (!args.subCategory || c.subCategory.toLowerCase() === args.subCategory.toLowerCase())
      );
      return match ? db.getAgencyByCode(match.agencyCode) : null;
    }
    case 'KnowledgeSearch':
      return db.searchKnowledge(args.query);
    default:
      return { error: `Unknown tool ${name}` };
  }
}

const SYSTEM_INSTRUCTION = `You are the 311 Citizen Assistant, a chatbot that ONLY helps with non-emergency
city service requests. You can:
- Help citizens report a problem (pothole, illegal parking, missed trash collection, noise complaint,
  damaged playground equipment, illegal dumping, street light problem, etc).
- Check the status or history of an existing request using its request number (format REQ-000001).
- Explain which city agency handles a type of issue.
- Answer common questions using the knowledge base.

Rules you must always follow:
- Never invent a request number. Only report one that a tool call actually returned.
- Never claim a request was created unless CreateServiceRequest actually succeeded.
- If required info (category or description) is missing, ask for it - don't guess.

LOCATION HANDLING - follow this exactly:
- Some messages will include a hidden line like "[Known location, not shown to citizen: lat X, lng Y]".
  This means the citizen's browser already detected their location automatically.
- When you have category, subCategory, and description, and a known lat/lng is available, ALWAYS show
  the citizen the detected location (as approximate coordinates, e.g. "18.52355, 73.82563") and explicitly
  ask: "Is this the correct location, or would you like to enter a different address?" Do not assume they
  want to use it - always ask first.
- If the citizen confirms the detected location is correct (e.g. "yes", "that's right", "use it"), use it
  as the address (format "Lat X, Lng Y") and pass the latitude/longitude to CreateServiceRequest as well.
- If the citizen provides a different address instead, use exactly what they typed as the address, and do
  NOT pass latitude/longitude (leave them out) since that address may not match the detected coordinates.
- If no known lat/lng is available at all, just ask the citizen for the address or nearest cross-street
  directly - don't mention "detected location" since none was detected.
- Only after the address is confirmed (either way), summarize category, description, and the confirmed
  address, and ask for final yes/no confirmation before calling CreateServiceRequest.

Keep replies concise and friendly, written for a citizen using a chat widget.`;

// Retries a Gemini call on transient errors (503 overloaded, 429 rate-limited
// per-minute bursts) with short exponential backoff. Does NOT retry on
// non-transient errors (400 bad request, daily quota exhaustion) since
// retrying those just wastes time and quota for no benefit.
async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      const isTransient = status === 503 || status === 429;
      if (!isTransient || i === attempts - 1) throw err;
      const delayMs = 1000 * Math.pow(2, i); // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function handleMessage(sessionId, userText, location) {
  const session = getSession(sessionId);
  const text = userText.trim();

  if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
    session.location = location;
  }

  if (detectEmergency(text)) {
    return {
      reply:
        'This sounds like it may be an emergency. Please call 911 (or your local emergency number) right away instead of filing a 311 request. If it is not actually an emergency, let me know and I can help you file a regular request.',
      toolCalls: [],
    };
  }

  if (detectOffTopic(text)) {
    return {
      reply:
        "I'm only able to help with 311 city services - reporting problems, checking request status, " +
        "finding which agency handles an issue, or answering questions from our knowledge base. " +
        "I can't help with that, but if you have a city service issue, let me know!",
      toolCalls: [],
      offTopic: true,
    };
  }

  const chat = ai.chats.create({
    model: MODEL,
    history: session.history,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ functionDeclarations }],
    },
  });

  const locationNote = session.location
    ? `\n\n[Known location, not shown to citizen: lat ${session.location.latitude}, lng ${session.location.longitude}]`
    : '';

  let response = await withRetry(() => chat.sendMessage({ message: text + locationNote }));
  const toolCallsUsed = [];

  for (let i = 0; i < 5; i++) {
    const call = response.functionCalls?.[0];
    if (!call) break;

    toolCallsUsed.push(call.name);
    const toolResult = await executeTool(call.name, call.args || {});

    if (call.name === 'CreateServiceRequest' && toolResult?.requestNumber) {
      session.lastRequestNumber = toolResult.requestNumber;
    }

    response = await withRetry(() =>
      chat.sendMessage({
        message: [
          {
            functionResponse: {
              name: call.name,
              response: { result: toolResult },
            },
          },
        ],
      })
    );
  }

  session.history = chat.getHistory();

  return {
    reply: response.text,
    toolCalls: toolCallsUsed,
  };
}

module.exports = { handleMessage, getSession };