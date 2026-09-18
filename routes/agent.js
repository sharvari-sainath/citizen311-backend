const express = require('express');
const router = express.Router();
const { handleMessage } = require('../agent/agentEngine');

// POST /api/agent/message  { sessionId, message, location? }
router.post('/message', async (req, res) => {
  try {
    const { sessionId, message, location } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ success: false, error: 'sessionId and message are required.' });
    }
    const result = await handleMessage(sessionId, message, location);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Agent error.' });
  }
});

module.exports = router;
