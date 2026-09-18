/**
 * MOCK DATAVERSE LAYER
 * -----------------------------------------------------------------------
 * Simulates Microsoft Dataverse using an in-memory JS object, mirroring
 * the 6 tables from PHASE 3 of the project plan:
 *   1. Citizen
 *   2. Agency
 *   3. Service Category
 *   4. Service Request
 *   5. Request Status History
 *   6. Knowledge Article
 *
 * WHY: The real plan requires an Azure subscription + Power Apps Dataverse
 * environment (Phase 1 & 2) before any of this can be real. This mock lets
 * you test 100% of the application logic (agent, tools, APIs, frontend,
 * voice) locally and for free before spending Azure credit. When Phase 2-4
 * are complete, only this file needs to be rewritten to call the real
 * Dataverse Web API — routes/, agent/, and the frontend stay the same.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');
const PERSIST = process.env.PERSIST === 'true';

function seedData() {
  return {
    citizens: [
      {
        citizenId: 'CIT-0001',
        name: 'Demo Citizen',
        email: 'demo@example.com',
        phone: '555-0100',
        address: '123 Main Street',
        preferredLanguage: 'English',
        createdDate: new Date().toISOString(),
      },
    ],

    agencies: [
      { agencyCode: 'DOT', agencyName: 'Department of Transportation', description: 'Roads, potholes, traffic signals, street signs.', phone: '311', email: 'dot@example.gov', active: true },
      { agencyCode: 'DSNY', agencyName: 'Department of Sanitation', description: 'Trash collection, recycling, littering.', phone: '311', email: 'sanitation@example.gov', active: true },
      { agencyCode: 'NYPD', agencyName: 'Police Department', description: 'Noise complaints, illegal parking, public safety.', phone: '311', email: 'police@example.gov', active: true },
      { agencyCode: 'PARKS', agencyName: 'Department of Parks', description: 'Parks maintenance, trees, playgrounds.', phone: '311', email: 'parks@example.gov', active: true },
    ],

    serviceCategories: [
      { id: 'SC-1', categoryName: 'Street', subCategory: 'Pothole', description: 'Report a pothole in the roadway.', agencyCode: 'DOT', active: true },
      { id: 'SC-2', categoryName: 'Street Lighting', subCategory: 'Street Light Problem', description: 'A street light is out or damaged.', agencyCode: 'DOT', active: true },
      { id: 'SC-3', categoryName: 'Parking', subCategory: 'Illegal Parking', description: 'Report a vehicle illegally parked.', agencyCode: 'NYPD', active: true },
      { id: 'SC-4', categoryName: 'Sanitation', subCategory: 'Missed Trash Collection', description: 'Trash was not collected on scheduled day.', agencyCode: 'DSNY', active: true },
      { id: 'SC-5', categoryName: 'Noise', subCategory: 'Noise Complaint', description: 'Report excessive or ongoing noise.', agencyCode: 'NYPD', active: true },
      { id: 'SC-6', categoryName: 'Parks', subCategory: 'Damaged Playground Equipment', description: 'Report damaged or unsafe playground equipment.', agencyCode: 'PARKS', active: true },
      { id: 'SC-7', categoryName: 'Sanitation', subCategory: 'Illegal Dumping', description: 'Report illegally dumped items or debris.', agencyCode: 'DSNY', active: true },
    ],

    serviceRequests: [],
    statusHistory: [],

    knowledgeArticles: [
      {
        id: 'KA-1',
        title: 'How do I report illegal parking?',
        question: 'How do I report illegal parking?',
        answer: 'Use "Report a Problem", choose category "Parking" and subcategory "Illegal Parking". Provide the location and, if possible, a description of the vehicle. The NYPD handles these requests.',
        category: 'Parking',
        keywords: ['illegal parking', 'parking', 'car', 'vehicle'],
        agencyCode: 'NYPD',
        url: '',
        active: true,
      },
      {
        id: 'KA-2',
        title: 'What do I do if my trash was not collected?',
        question: 'My trash was not picked up, what do I do?',
        answer: 'Report it under "Sanitation" -> "Missed Trash Collection". Include your address. The Department of Sanitation typically responds within 1-2 business days.',
        category: 'Sanitation',
        keywords: ['trash', 'garbage', 'missed collection', 'sanitation'],
        agencyCode: 'DSNY',
        url: '',
        active: true,
      },
      {
        id: 'KA-3',
        title: 'How long does it take to fix a pothole?',
        question: 'How long until a pothole is fixed?',
        answer: 'Standard potholes are typically addressed within 15-30 days depending on severity and agency workload. Emergency/hazardous potholes are prioritized and can be addressed faster.',
        category: 'Street',
        keywords: ['pothole', 'road', 'street', 'repair time'],
        agencyCode: 'DOT',
        url: '',
        active: true,
      },
      {
        id: 'KA-4',
        title: 'How do I check the status of my request?',
        question: 'How can I check my request status?',
        answer: 'Go to "Check Request Status" and enter your request number (format REQ-000001). You will see current status and full history.',
        category: 'General',
        keywords: ['status', 'check', 'request number', 'track'],
        agencyCode: '',
        url: '',
        active: true,
      },
    ],

    counters: { request: 0 },
  };
}

let db;

function load() {
  if (PERSIST && fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } else {
    db = seedData();
  }
}

function save() {
  if (PERSIST) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}

load();

function delay(ms = 120) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextRequestNumber() {
  db.counters.request += 1;
  const padded = String(db.counters.request).padStart(6, '0');
  return `REQ-${padded}`;
}

module.exports = {
  // ---------- Citizens ----------
  async getCitizens() {
    await delay();
    return db.citizens;
  },
  async findOrCreateCitizen({ name, email, phone, address, preferredLanguage } = {}) {
    await delay();
    let citizen = db.citizens.find((c) => email && c.email === email);
    if (!citizen) {
      citizen = {
        citizenId: `CIT-${String(db.citizens.length + 1).padStart(4, '0')}`,
        name: name || 'Anonymous Citizen',
        email: email || '',
        phone: phone || '',
        address: address || '',
        preferredLanguage: preferredLanguage || 'English',
        createdDate: new Date().toISOString(),
      };
      db.citizens.push(citizen);
      save();
    }
    return citizen;
  },

  // ---------- Agencies ----------
  async getAgencies() {
    await delay();
    return db.agencies.filter((a) => a.active);
  },
  async getAgencyByCode(code) {
    await delay();
    return db.agencies.find((a) => a.agencyCode === code) || null;
  },

  // ---------- Service Categories ----------
  async getServiceCategories() {
    await delay();
    return db.serviceCategories.filter((c) => c.active);
  },
  async searchServices(query) {
    await delay();
    const q = (query || '').toLowerCase().trim();
    if (!q) return db.serviceCategories.filter((c) => c.active);
    return db.serviceCategories.filter(
      (c) =>
        c.active &&
        (c.categoryName.toLowerCase().includes(q) ||
          c.subCategory.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q))
    );
  },

  // ---------- Service Requests ----------
  async createServiceRequest(payload) {
    await delay(250);
    const {
      category, subCategory, description, address, city, state, zipCode,
      latitude, longitude, citizenId, priority,
    } = payload;

    const matchedCategory = db.serviceCategories.find(
      (c) =>
        c.categoryName.toLowerCase() === (category || '').toLowerCase() &&
        c.subCategory.toLowerCase() === (subCategory || '').toLowerCase()
    );
    const agencyCode = matchedCategory ? matchedCategory.agencyCode : null;

    const requestNumber = nextRequestNumber();
    const now = new Date().toISOString();

    const request = {
      requestNumber,
      requestType: subCategory || category || 'General',
      category: category || 'General',
      subCategory: subCategory || '',
      description: description || '',
      status: 'Submitted',
      priority: priority || 'Medium',
      citizenId: citizenId || null,
      address: address || '',
      city: city || '',
      state: state || '',
      zipCode: zipCode || '',
      latitude: latitude || null,
      longitude: longitude || null,
      agencyCode,
      createdDate: now,
      updatedDate: now,
      resolution: '',
      closedDate: null,
    };

    db.serviceRequests.push(request);

    db.statusHistory.push({
      requestNumber,
      oldStatus: null,
      newStatus: 'Submitted',
      changedDate: now,
      changedBy: 'System',
      comment: 'Request created.',
    });

    // Simulate downstream workflow progression (like Power Automate / agency triage)
    setTimeout(() => _autoAdvance(requestNumber), 4000);

    save();
    return request;
  },

  async getServiceRequest(requestNumber) {
    await delay();
    return db.serviceRequests.find((r) => r.requestNumber === requestNumber) || null;
  },

  async getRequestsByCitizen(citizenId) {
    await delay();
    return db.serviceRequests.filter((r) => r.citizenId === citizenId);
  },

  async getAllRequests() {
    await delay();
    return db.serviceRequests;
  },

  async updateRequestStatus(requestNumber, newStatus, comment = '', changedBy = 'Agent') {
    await delay();
    const request = db.serviceRequests.find((r) => r.requestNumber === requestNumber);
    if (!request) return null;
    const oldStatus = request.status;
    request.status = newStatus;
    request.updatedDate = new Date().toISOString();
    if (newStatus === 'Closed' || newStatus === 'Resolved') {
      request.closedDate = new Date().toISOString();
      if (comment) request.resolution = comment;
    }
    db.statusHistory.push({
      requestNumber, oldStatus, newStatus,
      changedDate: new Date().toISOString(), changedBy, comment,
    });
    save();
    return request;
  },

  // ---------- Request Status History ----------
  async getRequestHistory(requestNumber) {
    await delay();
    return db.statusHistory
      .filter((h) => h.requestNumber === requestNumber)
      .sort((a, b) => new Date(a.changedDate) - new Date(b.changedDate));
  },

  // ---------- Knowledge Articles ----------
  async searchKnowledge(query) {
    await delay();
    const q = (query || '').toLowerCase();
    return db.knowledgeArticles.filter(
      (k) =>
        k.active &&
        (k.title.toLowerCase().includes(q) ||
          k.question.toLowerCase().includes(q) ||
          k.answer.toLowerCase().includes(q) ||
          k.keywords.some((kw) => q.includes(kw) || kw.includes(q)))
    );
  },
  async getAllKnowledge() {
    await delay();
    return db.knowledgeArticles.filter((k) => k.active);
  },

  // ---------- Admin / Analytics ----------
  async getDashboardStats() {
    await delay();
    const requests = db.serviceRequests;
    const byStatus = {};
    ['Submitted', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Closed', 'Rejected'].forEach((s) => {
      byStatus[s] = requests.filter((r) => r.status === s).length;
    });
    const byAgency = {};
    db.agencies.forEach((a) => {
      byAgency[a.agencyName] = requests.filter((r) => r.agencyCode === a.agencyCode).length;
    });
    const byCategory = {};
    db.serviceCategories.forEach((c) => {
      byCategory[`${c.categoryName} / ${c.subCategory}`] = requests.filter(
        (r) => r.category === c.categoryName && r.subCategory === c.subCategory
      ).length;
    });
    return { total: requests.length, byStatus, byAgency, byCategory };
  },

  _raw: () => db,
};

// Internal helper: simulate a request moving through its lifecycle so the
// Status page / Admin dashboard has something dynamic to show during a demo.
function _autoAdvance(requestNumber) {
  const request = db.serviceRequests.find((r) => r.requestNumber === requestNumber);
  if (!request) return;
  const progression = ['Submitted', 'Assigned', 'In Progress'];
  const idx = progression.indexOf(request.status);
  if (idx >= 0 && idx < progression.length - 1) {
    const oldStatus = request.status;
    const newStatus = progression[idx + 1];
    request.status = newStatus;
    request.updatedDate = new Date().toISOString();
    db.statusHistory.push({
      requestNumber, oldStatus, newStatus,
      changedDate: new Date().toISOString(),
      changedBy: 'System (simulated agency triage)',
      comment: `Automatically advanced to ${newStatus} for demo purposes.`,
    });
    save();
    setTimeout(() => _autoAdvance(requestNumber), 6000);
  }
}
