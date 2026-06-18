const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const Airtable = require('airtable');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

// Agent system prompts
const agents = {
  vp: `You are a VP of Marketing with 20 years of experience. 
  You receive campaign briefs and break them into specific tasks for your team.
  You delegate to: Writer (blog posts, copy, scripts), Designer (visual asset briefs), Social Media (platform posts).
  Respond in JSON format with this structure:
  {
    "strategy": "overall campaign strategy in 2-3 sentences",
    "tasks": {
      "writer": "specific writing task instructions",
      "designer": "specific design brief instructions", 
      "social": "specific social media task instructions"
    }
  }`,
  
  writer: `You are an expert content writer and copywriter.
  You receive writing tasks from the VP of Marketing and produce high quality content.
  Always match the brand tone requested. Be creative, engaging, and on-brand.
  Return your complete written content ready for review.`,
  
  designer: `You are a creative director and designer.
  You receive design tasks and produce detailed, actionable design briefs.
  Include: dimensions, colors, typography, imagery direction, and copy placement.
  Return a complete design brief that a designer or AI image tool can execute immediately.`,
  
  social: `You are a social media specialist with expertise across all platforms.
  You receive social media tasks and produce platform-optimized posts.
  Include hashtags, optimal posting times, and engagement hooks.
  Return complete ready-to-post content for each platform requested.`
};

// Run all agents
app.post('/api/run', async (req, res) => {
  const { brief } = req.body;
  
  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // VP of Marketing
    send({ agent: 'vp', status: 'working', message: 'Analyzing brief and creating strategy...' });
    const vpResponse = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: brief }],
      system: agents.vp
    });
    
    let vpResult;
    try {
      vpResult = JSON.parse(vpResponse.content[0].text);
    } catch {
      vpResult = { strategy: vpResponse.content[0].text, tasks: { writer: brief, designer: brief, social: brief }};
    }
    send({ agent: 'vp', status: 'done', result: vpResult.strategy });

    // Writer Agent
    send({ agent: 'writer', status: 'working', message: 'Writing content...' });
    const writerResponse = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: vpResult.tasks.writer }],
      system: agents.writer
    });
    const writerResult = writerResponse.content[0].text;
    send({ agent: 'writer', status: 'done', result: writerResult });

    // Designer Agent
    send({ agent: 'designer', status: 'working', message: 'Creating design brief...' });
    const designerResponse = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: vpResult.tasks.designer }],
      system: agents.designer
    });
    const designerResult = designerResponse.content[0].text;
    send({ agent: 'designer', status: 'done', result: designerResult });

    // Social Media Agent
    send({ agent: 'social', status: 'working', message: 'Creating social posts...' });
    const socialResponse = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: vpResult.tasks.social }],
      system: agents.social
    });
    const socialResult = socialResponse.content[0].text;
    send({ agent: 'social', status: 'done', result: socialResult });

    // Save to Airtable
    send({ agent: 'system', status: 'saving', message: 'Saving to review queue...' });
    
    const records = [
      { fields: { Name: `Writer - ${brief.substring(0,50)}`, Content: writerResult, Agent: 'Writer', Status: 'Needs Review', Brief: brief }},
      { fields: { Name: `Designer - ${brief.substring(0,50)}`, Content: designerResult, Agent: 'Designer', Status: 'Needs Review', Brief: brief }},
      { fields: { Name: `Social - ${brief.substring(0,50)}`, Content: socialResult, Agent: 'Social Media', Status: 'Needs Review', Brief: brief }}
    ];

   try {
      console.log('Attempting to save to Airtable...');
      console.log('Base ID:', process.env.AIRTABLE_BASE_ID);
      console.log('API Key exists:', !!process.env.AIRTABLE_API_KEY);
      const created = await base('Content').create(records, {typecast: true});
      console.log('Airtable save successful:', created.length, 'records');
      send({ agent: 'system', status: 'complete', message: 'All content saved to your review queue!' });
    } catch (airtableError) {
      console.log('Airtable error details:', airtableError);
      send({ agent: 'system', status: 'error', message: 'Airtable error: ' + airtableError.message });
    }

    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ agent: 'system', status: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

// Get review queue
app.get('/api/queue', async (req, res) => {
  try {
    const records = await base('Content').select({ filterByFormula: "{Status} = 'Needs Review'" }).all();
    res.json(records.map(r => ({ id: r.id, ...r.fields })));
  } catch (error) {
    res.json([]);
  }
});

// Update record status
app.patch('/api/queue/:id', async (req, res) => {
  try {
    const { status, notes } = req.body;
    await base('Content').update(req.params.id, { Status: status, Notes: notes || '' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Marketing Agents running at http://localhost:${PORT}`));