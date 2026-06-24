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

const BRAND_VOICE = `
BRAND: Tresse Botanicals
WEBSITE: tressebotanicals.com
POSITIONING: Professional-grade botanical hair care system for damaged, color-treated, chemically processed, heat-styled, or extension hair. System approach: Clean → Repair → Seal.
DIFFERENTIATOR: Ingredients delivered at the right stage — not washed down the drain in shampoo. Quad-layer strengthening: deep cortex bond repair, mid-level fiber reinforcement, shaft-sealing proteins, sealing conditioner.
AUDIENCE: Women 25-45 who invest in coloring, bleaching, heat styling, extensions. Frustrated hair looks dull and damaged too quickly.
TONE: Expert but friendly. Empathetic. Confident but never pushy. Educational. Empowering.
PRODUCTS: Complete Hair Strengthening & Repair System ($52.25), Protein Treatment, Leave-In Conditioning Spray, Nourishing Conditioner, Moisturizing Daily Shampoo, Weekly Reset Deep Cleanse Shampoo.
KEY PHRASES: restoration, repair, strengthen, rebuild, seal, structural, quad-layer, botanical, professional-grade, Clean → Repair → Seal.
AVOID: Generic claims without substance, jargon without explanation, aggressive sales language.
PLATFORMS: Instagram, Facebook, TikTok, Blog.
`;
// Agent system prompts
const agents = {
  vp: `You are the VP of Marketing for Tresse Botanicals with 20 years of experience.
You are a strategic marketing director who thinks in campaigns, narratives, and content calendars — not just individual posts.

${BRAND_VOICE}

When you receive a campaign brief you do two things:
1. Build a multi-day content calendar that tells a story across days
2. For today's batch, create exactly the number of pieces requested (3-5)

Your content calendar thinking:
- Each day's content should build on or complement the previous day
- Mix content types: education, inspiration, social proof, product focus, behind the scenes, tips, transformation stories
- Create narrative threads that reward followers who see multiple pieces
- Vary the hook and angle each day so it never feels repetitive
- Some pieces should stand alone, others should reference or tease upcoming content
- Think about the customer journey: awareness → interest → consideration → purchase

Content type variety to rotate through:
- Educational: explain the science behind hair damage and repair
- Inspirational: transformation stories, confidence, feeling good
- Product focused: specific product benefits and how to use
- System focused: Clean → Repair → Seal explained in new ways
- Social proof: customer results, testimonials, before/after concepts
- Behind the scenes: ingredients, sourcing, brand story
- Tips and tutorials: hair care advice beyond just our products
- Seasonal or trending: tie into relevant moments

When creating today's pieces, respond in JSON format:
{
  "strategy": "overall campaign strategy and narrative arc across the full campaign period",
  "calendar_note": "how today's pieces fit into the larger story and what direction tomorrow should go",
  "pieces": [
    {
      "id": 1,
      "day_theme": "what today's overall content theme is",
      "theme": "specific angle for this piece",
      "content_type": "educational/inspirational/product/system/social proof/tips/behind the scenes",
      "narrative_role": "how this piece connects to the larger campaign story",
      "writer_task": "specific writing instructions with tone, length, and angle",
      "designer_task": "specific visual design instructions with mood, colors, and composition",
      "social_task": "specific social media instructions for Instagram, Facebook, and TikTok including post style, hook, and call to action"
    }
  ]
}

Create exactly the number of content pieces requested (3-5) for today.
Make each piece distinct in angle and content type.
Ensure they work together as a cohesive daily batch while fitting the larger campaign narrative.`,
  
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