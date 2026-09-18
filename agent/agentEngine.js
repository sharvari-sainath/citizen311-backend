/**
 * AGENT ENGINE
 * -----------------------------------------------------------------------
 * This simulates the Microsoft Foundry "311 Citizen Assistant" agent from
 * PHASE 8-10 of the plan, using simple rule-based intent detection instead
 * of a hosted LLM (so the whole project runs free, offline, and instantly).
 *
 * It follows the exact agent instructions from your plan:
 *   - Help find services, report problems, check status/history, find
 *     agencies, answer knowledge questions.
 *   - Never invent a request number.
 *   - Never claim a request was created unless CreateServiceRequest
 *     confirms success.
 *   - Ask for missing information.
 *   - Before creating a request: summarize and ask for confirmation.
 *   - Emergency requests are redirected, not filed as normal 311 requests.
 *
 * DROP-IN UPGRADE PATH: once you have a Foundry project (Phase 8) and want
 * a real LLM instead of these rules, replace the body of `handleMessage`
 * with a call to your Foundry agent endpoint (or the Anthropic/OpenAI API),
 * passing these same tool functions as callable tools. The conversation
 * session shape below (session.slots, session.stage) can be handed to the
 * LLM as context so the swap is close to drop-in.
 * -----------------------------------------------------------------------
 */

const db = require('../mock/mockDataverse');

// In-memory conversation sessions, keyed by sessionId (per browser tab).
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      stage: 'idle', // idle | collecting | confirming
      slots: { category: null, subCategory: null, description: null, address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null },
      location: null, // last known browser-detected location, reused across turns
      awaitingManualAddress: false,
      lastRequestNumber: null,
    });
  }
  return sessions.get(sessionId);
}

const EMERGENCY_WORDS = ['fire', 'gas leak', 'explosion', 'shooting', 'gun', 'bleeding', 'heart attack', 'someone is trapped', 'life threatening', 'emergency'];

const CATEGORY_KEYWORDS = [
  { category: 'Street', subCategory: 'Pothole', words: ['pothole', 'hole in the road', 'hole in the street'] },
  { category: 'Street Lighting', subCategory: 'Street Light Problem', words: ['street light', 'streetlight', 'lamp post', 'light is out'] },
  { category: 'Parking', subCategory: 'Illegal Parking', words: ['illegal parking', 'illegally parked', 'blocking driveway', 'parked in front of'] },
  { category: 'Sanitation', subCategory: 'Missed Trash Collection', words: ['trash', 'garbage', 'missed collection', 'didn\u2019t pick up', 'not collected'] },
  { category: 'Sanitation', subCategory: 'Illegal Dumping', words: ['dumping', 'dumped', 'illegal dump'] },
  { category: 'Noise', subCategory: 'Noise Complaint', words: ['noise', 'loud music', 'noisy', 'construction noise'] },
  { category: 'Parks', subCategory: 'Damaged Playground Equipment', words: ['playground', 'park equipment', 'broken swing', 'broken slide'] },
];

function detectEmergency(text) {
  const t = text.toLowerCase();
  return EMERGENCY_WORDS.some((w) => t.includes(w));
}

function detectCategory(text) {
  const t = text.toLowerCase();
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.words.some((w) => t.includes(w))) {
      return { category: entry.category, subCategory: entry.subCategory };
    }
  }
  return null;
}

function detectRequestNumber(text) {
  const match = text.toUpperCase().match(/REQ-\d{6}/);
  return match ? match[0] : null;
}

function detectStatusIntent(text) {
  const t = text.toLowerCase();
  return /status|where is my|track|check on/.test(t);
}

function detectHistoryIntent(text) {
  const t = text.toLowerCase();
  return /history|timeline|what happened to/.test(t);
}

function detectReportIntent(text) {
  const t = text.toLowerCase();
  return /report|there is a|there's a|i have a|i want to report|found a|complain/.test(t) || detectCategory(text) !== null;
}

function detectAgencyIntent(text) {
  const t = text.toLowerCase();
  return /who handles|which agency|who is responsible|who fixes/.test(t);
}

// General "what is this / what can you do / tell me about 311" intent -
// previously this fell through to the generic fallback message even though
// it's a perfectly on-topic question, so it now gets a real answer built
// from the live category/agency data.
function detectAboutIntent(text) {
  const t = text.toLowerCase();
  return /tell me about 311|what is 311|what can you do|what services (do you|are)|what do you do|how does this work|about 311|what is this (app|site|assistant)/.test(t);
}

// Explicit off-topic scope guard. The assistant should only ever discuss
// 311 city-service topics (reporting problems, request status, agencies,
// knowledge base) - not act as a general-purpose chatbot. Rather than
// silently guessing at unrelated requests (recipes, jokes, general trivia,
// coding help, etc.) and risking a made-up answer, it explicitly declines
// and redirects back to what it can actually help with.
const OFF_TOPIC_WORDS = [
  'recipe', 'pav bhaji', 'how to cook', 'how do i make', 'joke', 'funny story',
  'weather forecast', 'stock price', 'movie', 'song lyrics', 'write code',
  'write a program', 'homework', 'translate', 'poem', 'write a story',
  'sports score', 'who won the', 'capital of', 'math problem', 'solve for x',
  'calculate', 'what is the meaning of life', 'tell me a story', 'write an essay',
  'who is the president', 'what year did', 'define ', 'synonym for',
];

function detectOffTopic(text) {
  const t = text.toLowerCase();
  return OFF_TOPIC_WORDS.some((w) => t.includes(w));
}

function detectAffirmative(text) {
  return /^(yes|yep|yeah|correct|confirm|submit|go ahead|sure|do it|y)\b/i.test(text.trim());
}

function detectNegative(text) {
  return /^(no|nope|cancel|stop|don't|do not|n)\b/i.test(text.trim());
}

// Very rough address heuristic: has a number followed by words.
function looksLikeAddress(text) {
  return /\d+\s+\w+/.test(text);
}

async function handleMessage(sessionId, userText, location) {
  const session = getSession(sessionId);
  const text = userText.trim();

  // Remember the most recently reported browser location for this session
  // (sent silently by the frontend on every turn) so the agent never has
  // to ask the person to type an address - it's captured automatically.
  if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
    session.location = location;
  }

  // 0. Emergency check overrides everything.
  if (detectEmergency(text)) {
    session.stage = 'idle';
    return {
      reply:
        'This sounds like it may be an emergency. Please call 911 (or your local emergency number) right away instead of filing a 311 request. If it is not actually an emergency, let me know and I can help you file a regular request.',
      toolCalls: [],
    };
  }

  // 1. If we are mid-flow collecting info for a new request.
  if (session.stage === 'collecting') {
    return await continueCollecting(session, text);
  }

  // 2. If we are waiting for a yes/no confirmation.
  if (session.stage === 'confirming') {
    if (detectAffirmative(text)) {
      return await submitRequest(session);
    }
    if (detectNegative(text)) {
      session.stage = 'idle';
      session.slots = { category: null, subCategory: null, description: null, address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null };
      session.awaitingManualAddress = false;
      return { reply: 'No problem, I\u2019ve cancelled that. Is there anything else I can help with?', toolCalls: [] };
    }
    // Treat as an edit/extra info rather than yes/no.
    return await continueCollecting(session, text);
  }

  // 3. Check request status (Tool 2 + Tool 3).
  const reqNum = detectRequestNumber(text);
  if (reqNum) {
    const request = await db.getServiceRequest(reqNum);
    if (!request) {
      return { reply: `I couldn't find a request with number ${reqNum}. Please double check the number and try again.`, toolCalls: ['GetServiceRequest'] };
    }
    const history = await db.getRequestHistory(reqNum);
    const agency = request.agencyCode ? await db.getAgencyByCode(request.agencyCode) : null;
    const historyLine = history.map((h) => h.newStatus).join(' -> ');
    return {
      reply: `Request ${reqNum} (${request.subCategory || request.category}) is currently **${request.status}**${agency ? `, assigned to ${agency.agencyName}` : ''}. Address: ${request.address}. Submitted: ${new Date(request.createdDate).toLocaleDateString()}. History: ${historyLine}.`,
      toolCalls: ['GetServiceRequest', 'GetRequestHistory'],
      request,
      history,
    };
  }
  // Asked about status/history but didn't include a request number yet.
  if ((detectStatusIntent(text) || detectHistoryIntent(text)) && !detectReportIntent(text)) {
    return {
      reply: "Sure - what's your request number? It looks like REQ-000001 and was given to you when you first submitted the request.",
      toolCalls: [],
    };
  }

  // 3.5 "Tell me about 311 / what can you do" -> give a real, useful answer
  // instead of falling through to the generic catch-all.
  if (detectAboutIntent(text)) {
    const categories = await db.getServiceCategories();
    const agencies = await db.getAgencies();
    const categoryList = categories.map((c) => `${c.categoryName} (${c.subCategory})`).join(', ');
    const agencyList = agencies.map((a) => a.agencyName).join(', ');
    return {
      reply:
        `The 311 Citizen Assistant helps you report non-emergency city issues and track them ` +
        `through to resolution. Here's what I can do:\n\n` +
        `- **Report a problem**: ${categoryList}\n` +
        `- **Check status or history** of an existing request using its number (e.g. REQ-000001)\n` +
        `- **Find which agency handles an issue** &mdash; we currently route to: ${agencyList}\n` +
        `- **Answer common questions** from our knowledge base\n\n` +
        `Just tell me what's going on, like "there's a pothole on Main Street", and I'll take it from there.`,
      toolCalls: ['SearchServices', 'FindAgency'],
    };
  }

  // 4. Find agency intent (Tool 5).
  if (detectAgencyIntent(text)) {
    const detected = detectCategory(text);
    if (detected) {
      const categories = await db.getServiceCategories();
      const match = categories.find((c) => c.categoryName === detected.category && c.subCategory === detected.subCategory);
      const agency = match ? await db.getAgencyByCode(match.agencyCode) : null;
      return {
        reply: agency
          ? `${detected.subCategory} issues are handled by **${agency.agencyName}**. ${agency.description}`
          : `I couldn't determine which agency handles that. Could you describe the issue a bit more?`,
        toolCalls: ['FindAgency'],
      };
    }
    return { reply: 'Which type of issue are you asking about? For example: pothole, illegal parking, noise, missed trash pickup, or a street light.', toolCalls: [] };
  }

  // 5. Report a problem intent -> start collecting (Tool 1 flow).
  if (detectReportIntent(text)) {
    const detected = detectCategory(text);
    session.stage = 'collecting';
    session.slots = { category: null, subCategory: null, description: text, address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null };
    if (detected) {
      session.slots.category = detected.category;
      session.slots.subCategory = detected.subCategory;
    }
    return await continueCollecting(session, '');
  }

  // 6. Search services intent (Tool 4) - if the message matches a service by keyword search.
  const searchResults = await db.searchServices(text);
  if (searchResults.length > 0 && text.split(' ').length <= 6) {
    const list = searchResults.map((s) => `${s.categoryName} -> ${s.subCategory}`).join(', ');
    return {
      reply: `Here's what I found related to "${text}": ${list}. Would you like to report one of these, or ask something else?`,
      toolCalls: ['SearchServices'],
    };
  }

  // 7. Knowledge base fallback.
  const knowledge = await db.searchKnowledge(text);
  if (knowledge.length > 0) {
    return { reply: knowledge[0].answer, toolCalls: ['KnowledgeSearch'], article: knowledge[0] };
  }

  // 7.5 Explicit off-topic decline - checked only after every genuine 311
  // intent (report, status, agency, search, knowledge) has already failed
  // to match, so a legitimate but oddly-phrased 311 question never gets
  // mistakenly declined.
  if (detectOffTopic(text)) {
    return {
      reply:
        "I'm only able to help with 311 city services &mdash; reporting problems, checking request status, " +
        "finding which agency handles an issue, or answering questions from our knowledge base. " +
        "I can't help with that, but if you have a city service issue, let me know!",
      toolCalls: [],
      offTopic: true,
    };
  }

  // 8. Default help message.
  return {
    reply:
      "I'm the 311 Citizen Assistant. I can help you report a problem (like a pothole, illegal parking, noise, or missed trash pickup), check the status or history of an existing request, find which agency handles an issue, or answer common questions. What would you like to do?",
    toolCalls: [],
  };
}

async function continueCollecting(session, text) {
  const slots = session.slots;

  // If we previously asked for a manual address (location detection
  // failed), the very next message is treated as that address rather
  // than as a category/description update.
  if (session.awaitingManualAddress) {
    if (text) {
      slots.address = text;
      session.awaitingManualAddress = false;
    } else {
      return {
        reply: "I wasn't able to detect your location automatically - could you share the address or nearest cross-street?",
        toolCalls: [],
        awaitingManualAddress: true,
      };
    }
  }

  // Try to fill category from free text if still missing.
  if (!slots.category) {
    const detected = detectCategory(text);
    if (detected) {
      slots.category = detected.category;
      slots.subCategory = detected.subCategory;
    }
  }

  // Description: keep first substantial thing said, else refine with the
  // latest message while we're still waiting on other required info.
  if (!slots.description && text) {
    slots.description = text;
  } else if (slots.description && text && text.length > 15) {
    slots.description = text;
  }

  // Ask for whichever required slot is still missing, in order. Address is
  // intentionally NOT asked for here - it's captured automatically from
  // the browser's location as soon as it's available (see handleMessage),
  // so the only things we ever ask the person for are the issue type and
  // a description.
  if (!slots.category || !slots.subCategory) {
    return {
      reply: 'What type of problem is this? For example: pothole, illegal parking, noise complaint, missed trash collection, street light, damaged playground equipment, or illegal dumping.',
      toolCalls: [],
    };
  }
  if (!slots.description) {
    return { reply: `Got it, a ${slots.subCategory} issue. Can you describe the problem in a bit more detail?`, toolCalls: [] };
  }

  // If we still don't have a location by this point (permission denied,
  // unsupported browser, etc.) and no manual address was given either,
  // ask for one - we never invent an address.
  if (!session.location && !slots.address) {
    session.awaitingManualAddress = true;
    return {
      reply:
        "I wasn't able to detect your location automatically - could you share the address or nearest cross-street?",
      toolCalls: [],
      awaitingManualAddress: true,
    };
  }

  // All required info present -> summarize and ask for confirmation.
  const locationLabel = slots.address || session.location.address || session.location.formatted ||
    `${session.location.latitude.toFixed(5)}, ${session.location.longitude.toFixed(5)}`;

  session.stage = 'confirming';
  return {
    reply: `Here's what I have:\n\n- **Category:** ${slots.category} / ${slots.subCategory}\n- **Description:** ${slots.description}\n- **Location (detected automatically):** ${locationLabel}\n\nWould you like me to submit this request? (yes/no)`,
    toolCalls: [],
    pendingConfirmation: true,
  };
}

async function submitRequest(session) {
  const slots = session.slots;
  const loc = session.location || {};
  const address = loc.address || loc.formatted || (slots.address || '');

  const request = await db.createServiceRequest({
    category: slots.category,
    subCategory: slots.subCategory,
    description: slots.description,
    address,
    city: loc.city || slots.city || '',
    state: loc.state || slots.state || '',
    zipCode: loc.zipCode || slots.zipCode || '',
    latitude: loc.latitude ?? null,
    longitude: loc.longitude ?? null,
  });

  session.lastRequestNumber = request.requestNumber;
  session.stage = 'idle';
  session.slots = { category: null, subCategory: null, description: null, address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null };

  return {
    reply: `Your request has been submitted. Your request number is **${request.requestNumber}**. You can check its status anytime using this number.`,
    toolCalls: ['CreateServiceRequest'],
    request,
  };
}

module.exports = { handleMessage, getSession };
