/**
 * 311 Citizen Assistant - Mock Backend
 * -----------------------------------------------------------------------
 * This Express server stands in for Azure Functions (Phase 7) talking to
 * Dataverse (Phase 3-4). It exposes the same tool endpoints your Foundry
 * agent will call once you build the real thing (Phase 9), plus a simple
 * built-in rule-based agent (agent/agentEngine.js) so you can test the
 * full conversational flow today without Foundry, without an LLM, and
 * without spending Azure credit.
 * -----------------------------------------------------------------------
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const toolsRouter = require('./routes/tools');
const agentRouter = require('./routes/agent');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '311 Citizen Assistant mock backend is running.' });
});

app.use('/api', toolsRouter);
app.use('/api/agent', agentRouter);

app.listen(PORT, () => {
  console.log(`311 Citizen Assistant backend (mock Dataverse) running on http://localhost:${PORT}`);
});
