/**
 * AGENT ENGINE (Gemini-powered)
 * -----------------------------------------------------------------------
 * Replaces the old rule-based intent detection with a real LLM (Google
 * Gemini) using function calling. Gemini decides which tool to call
 * (CreateServiceRequest, GetServiceRequest, GetRequestHistory,
 * SearchServices, FindAgency, KnowledgeSearch) based on the conversation,
 * and we execute that tool against mock/mockDataverse.js and hand the
 * result back to Gemini to produce the final natural-language reply.
 *
 * Emergency detection and off-topic refusal are kept as hard guards in
 * plain code (not left to the model) since those are safety-critical and
 * should never depend on a model call succeeding or behaving as expected.
 * -----------------------------------------------------------------------
 */

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const db = require('../mock/mockDataverse');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
const tools = [
  {
    functionDeclarations: [
      {
        name: 'CreateServiceRequest',
        description: 'File a new 311 service request once category, subCategory, description, and address are all known. Never call this without confirming with the citizen first.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            category: { type: SchemaType.STRING, description: 'e.g. Street, Sanitation, Parking, Noise, Parks, Street Lighting' },
            subCategory: { type: SchemaType.STRING, description: 'e.g. Pothole, Illegal Parking, Missed Trash Collection, Noise Complaint' },
            description: { type: SchemaType.STRING },
            address: { type: SchemaType.STRING },
            city: { type: SchemaType.STRING },
            state: { type: SchemaType.STRING },
            zipCode: { type: SchemaType.STRING },
          },
          required: ['category', 'subCategory', 'description', 'address'],
        },
      },
      {
        name: 'GetServiceRequest',
        description: 'Look up a service request by its number, format REQ-000001.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: { requestNumber: { type: SchemaType.STRING } },
          required: ['requestNumber'],
        },
      },
      {
        name: 'GetRequestHistory',
        description: 'Get the status change history/timeline for a service request.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: { requestNumber: { type: SchemaType.STRING } },
          required: ['requestNumber'],
        },
      },
      {
        name: 'SearchServices',
        description: 'Search the list of 311 service categories by keyword.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: { query: { type: SchemaType.STRING } },
          required: ['query'],
        },
      },
      {
        name: 'FindAgency',
        description: 'Find which city agency handles a given category/subCategory of issue.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            category: { type: SchemaType.STRING },
            subCategory: { type: SchemaType.STRING },
          },
          required: ['category'],
        },
      },
      {
        name: 'KnowledgeSearch',
        description: 'Search the knowledge base for answers to common questions.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: { query: { type: SchemaType.STRING } },
          required: ['query'],
        },
      },
    ],
  },
];

// ---------- Execute a tool call against the mock Dataverse layer ----------
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
- Before calling CreateServiceRequest, always summarize the category, description, and address back to
  the citizen and get an explicit yes/confirmation first.
- If required info (category, description, or address) is missing, ask for it - don't guess.
- Keep replies concise and friendly, written for a citizen using a chat widget.`;

const model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  systemInstruction: SYSTEM_INSTRUCTION,
  tools,
});

async function handleMessage(sessionId, userText, location) {
  const session = getSession(sessionId);
  const text = userText.trim();

  if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
    session.location = location;
  }

  // Hard safety guard - never let the model handle this.
  if (detectEmergency(text)) {
    return {
      reply:
        'This sounds like it may be an emergency. Please call 911 (or your local emergency number) right away instead of filing a 311 request. If it is not actually an emergency, let me know and I can help you file a regular request.',
      toolCalls: [],
    };
  }

  // Hard scope guard - never let the model wander off-topic.
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

  const chat = model.startChat({ history: session.history });

  // Silently give the model the citizen's known location as extra context.
  const locationNote = session.location
    ? `\n\n[Known location, not shown to citizen: lat ${session.location.latitude}, lng ${session.location.longitude}]`
    : '';

  let result = await chat.sendMessage(text + locationNote);
  const toolCallsUsed = [];

  // Loop: keep executing tool calls Gemini requests until it gives a final text reply.
  for (let i = 0; i < 5; i++) {
    const call = result.response.functionCalls()?.[0];
    if (!call) break;

    toolCallsUsed.push(call.name);
    const toolResult = await executeTool(call.name, call.args || {});

    if (call.name === 'CreateServiceRequest' && toolResult?.requestNumber) {
      session.lastRequestNumber = toolResult.requestNumber;
    }

    result = await chat.sendMessage([
      {
        functionResponse: {
          name: call.name,
          response: { result: toolResult },
        },
      },
    ]);
  }

  session.history = await chat.getHistory();

  return {
    reply: result.response.text(),
    toolCalls: toolCallsUsed,
  };
}

module.exports = { handleMessage, getSession };