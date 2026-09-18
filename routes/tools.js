/**
 * These routes simulate the Azure Functions from PHASE 7 of the plan:
 *   Tool 1 - CreateServiceRequest
 *   Tool 2 - GetServiceRequest
 *   Tool 3 - GetRequestHistory
 *   Tool 4 - SearchServices
 *   Tool 5 - FindAgency
 *
 * Plus supporting endpoints for citizens, agencies, knowledge, and admin
 * analytics so the whole 311 experience works end-to-end.
 *
 * When you're ready to go live: rewrite mock/mockDataverse.js to call the
 * real Dataverse Web API (OAuth/Entra ID) - these routes stay identical.
 */

const express = require('express');
const router = express.Router();
const db = require('../mock/mockDataverse');

// ---------- Tool 1: CreateServiceRequest ----------
router.post('/create-service-request', async (req, res) => {
  try {
    const { category, subCategory, description, address, city, state, zipCode, priority } = req.body;

    if (!category || !subCategory || !description || !address) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: category, subCategory, description, address are required.',
      });
    }

    // Emergency requests should not be created as normal 311 requests.
    if (priority === 'Emergency') {
      return res.status(200).json({
        success: false,
        emergency: true,
        message:
          'This sounds like an emergency. Please call 911 (or your local emergency number) instead of submitting a standard 311 request.',
      });
    }

    let citizenId = req.body.citizenId || null;
    if (!citizenId && req.body.citizen) {
      const citizen = await db.findOrCreateCitizen(req.body.citizen);
      citizenId = citizen.citizenId;
    }

    const request = await db.createServiceRequest({
      category, subCategory, description, address, city, state, zipCode, citizenId, priority,
    });

    res.json({ success: true, requestNumber: request.requestNumber, status: request.status, request });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal error creating request.' });
  }
});

// ---------- Tool 2: GetServiceRequest ----------
router.get('/service-request/:requestNumber', async (req, res) => {
  try {
    const request = await db.getServiceRequest(req.params.requestNumber.toUpperCase());
    if (!request) return res.status(404).json({ success: false, error: 'Request not found.' });
    let agency = null;
    if (request.agencyCode) agency = await db.getAgencyByCode(request.agencyCode);
    res.json({ success: true, request, agency });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal error fetching request.' });
  }
});

// ---------- Tool 3: GetRequestHistory ----------
router.get('/request-history/:requestNumber', async (req, res) => {
  try {
    const requestNumber = req.params.requestNumber.toUpperCase();
    const request = await db.getServiceRequest(requestNumber);
    if (!request) return res.status(404).json({ success: false, error: 'Request not found.' });
    const history = await db.getRequestHistory(requestNumber);
    res.json({ success: true, history });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal error fetching history.' });
  }
});

// ---------- Tool 4: SearchServices ----------
router.get('/search-services', async (req, res) => {
  try {
    const results = await db.searchServices(req.query.q || '');
    res.json({ success: true, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal error searching services.' });
  }
});

// ---------- Tool 5: FindAgency ----------
router.get('/find-agency', async (req, res) => {
  try {
    const { category, subCategory, agencyCode } = req.query;
    if (agencyCode) {
      const agency = await db.getAgencyByCode(agencyCode);
      return res.json({ success: true, agency });
    }
    const categories = await db.getServiceCategories();
    const match = categories.find(
      (c) =>
        c.categoryName.toLowerCase() === (category || '').toLowerCase() &&
        (!subCategory || c.subCategory.toLowerCase() === subCategory.toLowerCase())
    );
    if (!match) return res.json({ success: true, agency: null });
    const agency = await db.getAgencyByCode(match.agencyCode);
    res.json({ success: true, agency });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal error finding agency.' });
  }
});

// ---------- Supporting: Citizens' own requests ----------
router.get('/my-requests/:citizenId', async (req, res) => {
  const requests = await db.getRequestsByCitizen(req.params.citizenId);
  res.json({ success: true, requests });
});

// ---------- Supporting: Categories / Agencies / Knowledge ----------
router.get('/categories', async (req, res) => {
  res.json({ success: true, categories: await db.getServiceCategories() });
});

router.get('/agencies', async (req, res) => {
  res.json({ success: true, agencies: await db.getAgencies() });
});

router.get('/knowledge', async (req, res) => {
  const q = req.query.q;
  const results = q ? await db.searchKnowledge(q) : await db.getAllKnowledge();
  res.json({ success: true, results });
});

// ---------- Admin ----------
router.get('/admin/requests', async (req, res) => {
  res.json({ success: true, requests: await db.getAllRequests() });
});

router.get('/admin/stats', async (req, res) => {
  res.json({ success: true, stats: await db.getDashboardStats() });
});

router.patch('/admin/requests/:requestNumber/status', async (req, res) => {
  const { status, comment, changedBy } = req.body;
  const updated = await db.updateRequestStatus(req.params.requestNumber, status, comment, changedBy);
  if (!updated) return res.status(404).json({ success: false, error: 'Request not found.' });
  res.json({ success: true, request: updated });
});

module.exports = router;
