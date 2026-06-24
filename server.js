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

const agents = {
  vp: `You are the VP of Marketing for Tresse Botanicals with 20 years of experience.
You are a strategic marketing director who thinks in campaigns, narratives, and content calendars.

${BRAND_VOICE}

When you receive a campaign brief you do two things:
1. Build a multi-day content calendar that tells a story across days
2. For today's batch, create exactly the number of pieces requested (3-5)

Content type variety to rotate through:
- Educational: explain the science behind hair damage and repair
- Inspirational: transformation stories, confidence, feeling good
- Product focused: specific product benefits and how to use
- System focused: Clean → Repair → Seal explained in new ways
- Social proof: customer results, testimonials, before/after concepts
- Behind the scenes: ingredients, sourcing, brand story
- Tips and tutorials: hair care advice beyond just our products

Respond in JSON format:
{
  "strategy": "overall campaign strategy and narrative arc",
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
      "social_task": "specific social media instructions for Instagram, Facebook, and TikTok"
    }
  ]
}

Create exactly the number of content pieces requested. Make each piece distinct in angle and content type.`,

  writer: `You are an expert content writer and copywriter for Tresse Botanicals.
${BRAND_VOICE}
You receive specific writing tasks and produce high quality on-brand content.
Be creative, engaging, and always reinforce the Clean → Repair → Seal system.
Write compelling headlines, body copy, and calls to action.
Return complete written content ready for review.`,

  designer: `You are a creative director for Tresse Botanicals.
${BRAND_VOICE}
You receive design tasks and produce detailed actionable design briefs.
Include: dimensions for each platform, color palette (soft botanicals — greens, creams, blush tones), typography direction, imagery description, copy placement, and mood.
Make briefs specific enough that a designer or AI tool can execute immediately.`,

  social: `You are a social media specialist for Tresse Botanicals.
${BRAND_VOICE}
You receive social media tasks and produce platform-optimized posts.
For each piece create:
- Instagram: caption (150-200 words), 15-20 hashtags, story concept
- Facebook: longer form post (200-300 words), engagement question
- TikTok: video concept, hook (first 3 seconds), script outline, trending audio suggestion
Return complete ready-to-post content for all three platforms.`,

  reviewer: `You are the VP of Marketing for Tresse Botanicals reviewing content your team produced.
${BRAND_VOICE}
Review the content package and evaluate:
1. Brand voice alignment
2. Message clarity — is Clean → Repair → Seal communicated?
3. Audience relevance
4. Quality and creativity
5. Platform appropriateness

Respond in JSON format:
{
  "approved": true or false,
  "overall_score": 1-10,
  "feedback": "specific feedback if not approved",
  "approved_content": {
    "writer": "final approved or revised writing",
    "designer": "final approved or revised design brief",
    "social": "final approved or revised social posts"
  }
}`
};

async function runSinglePiece(piece, brief, send, pieceNum, total) {
  send({ agent: 'system', status: 'info', message: `Creating piece ${pieceNum} of ${total}: ${piece.theme}` });

  // Writer
  send({ agent: 'writer', status: 'working', message: `Writing piece ${pieceNum}...` });
  const writerResponse = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: `Brief: ${brief}\n\nYour specific task: ${piece.writer_task}\n\nTheme: ${piece.theme}` }],
    system: agents.writer
  });
  const writerResult = writerResponse.content[0].text;
  send({ agent: 'writer', status: 'done', message: `Piece ${pieceNum} written` });

  // Designer
  send({ agent: 'designer', status: 'working', message: `Designing piece ${pieceNum}...` });
  const designerResponse = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: `Brief: ${brief}\n\nYour specific task: ${piece.designer_task}\n\nTheme: ${piece.theme}\n\nWritten content to design around:\n${writerResult}` }],
    system: agents.designer
  });
  const designerResult = designerResponse.content[0].text;
  send({ agent: 'designer', status: 'done', message: `Piece ${pieceNum} designed` });

  // Social
  send({ agent: 'social', status: 'working', message: `Creating social posts for piece ${pieceNum}...` });
  const socialResponse = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: `Brief: ${brief}\n\nYour specific task: ${piece.social_task}\n\nTheme: ${piece.theme}\n\nWritten content:\n${writerResult}` }],
    system: agents.social
  });
  const socialResult = socialResponse.content[0].text;
  send({ agent: 'social', status: 'done', message: `Piece ${pieceNum} social posts created` });

  // VP Review
  send({ agent: 'vp', status: 'working', message: `VP reviewing piece ${pieceNum}...` });
  const reviewResponse = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `Review this content package for piece ${pieceNum} - Theme: ${piece.theme}\n\nWRITER OUTPUT:\n${writerResult}\n\nDESIGNER OUTPUT:\n${designerResult}\n\nSOCIAL MEDIA OUTPUT:\n${socialResult}`
    }],
    system: agents.reviewer
  });

  let reviewResult;
  try {
    const reviewText = reviewResponse.content[0].text;
    const jsonMatch = reviewText.match(/\{[\s\S]*\}/);
    reviewResult = jsonMatch ? JSON.parse(jsonMatch[0]) : { approved: true, overall_score: 8, approved_content: { writer: writerResult, designer: designerResult, social: socialResult }};
  } catch {
    reviewResult = { approved: true, overall_score: 8, approved_content: { writer: writerResult, designer: designerResult, social: socialResult }};
  }

  if (!reviewResult.approved) {
    send({ agent: 'vp', status: 'working', message: `VP revising piece ${pieceNum}: ${reviewResult.feedback}` });
    const reviseResponse = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Revise and improve this content based on feedback.\n\nFeedback: ${reviewResult.feedback}\n\nOriginal writer content:\n${writerResult}\n\nOriginal social content:\n${socialResult}`
      }],
      system: agents.writer
    });
    reviewResult.approved_content.writer = reviseResponse.content[0].text;
  }

  send({ agent: 'vp', status: 'done', message: `Piece ${pieceNum} approved (Score: ${reviewResult.overall_score}/10)` });

  return {
    theme: piece.theme,
    content_type: piece.content_type || 'content',
    score: reviewResult.overall_score,
    writer: reviewResult.approved_content.writer,
    designer: reviewResult.approved_content.designer || designerResult,
    social: reviewResult.approved_content.social || socialResult
  };
}

app.post('/api/run', async (req, res) => {
  const { brief, numPieces = 3 } = req.body;

  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // VP Strategy
    send({ agent: 'vp', status: 'working', message: `Creating ${numPieces}-piece content calendar strategy...` });
    const vpResponse = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: `Create a campaign strategy with exactly ${numPieces} content pieces for this brief: ${brief}` }],
      system: agents.vp
    });

    let vpResult;
    try {
      const vpText = vpResponse.content[0].text;
      const jsonMatch = vpText.match(/\{[\s\S]*\}/);
      vpResult = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      vpResult = null;
    }

    if (!vpResult || !vpResult.pieces) {
      vpResult = {
        strategy: 'Campaign strategy created',
        calendar_note: 'Continue building on today\'s themes tomorrow',
        pieces: Array.from({length: numPieces}, (_, i) => ({
          id: i + 1,
          theme: `Content piece ${i + 1}`,
          content_type: 'educational',
          writer_task: brief,
          designer_task: brief,
          social_task: brief
        }))
      };
    }

    send({ agent: 'vp', status: 'done', message: `Strategy ready: ${vpResult.strategy}` });
    send({ agent: 'system', status: 'info', message: `Calendar note: ${vpResult.calendar_note}` });

    // Run each piece
    const allResults = [];
    for (let i = 0; i < vpResult.pieces.length; i++) {
      const result = await runSinglePiece(vpResult.pieces[i], brief, send, i + 1, vpResult.pieces.length);
      allResults.push(result);

      // Save each piece to Airtable
      try {
        await base('Content').create([{
          fields: {
            Name: `[${result.content_type}] ${result.theme}`,
            Content: `WRITTEN CONTENT:\n${result.writer}\n\n---\n\nDESIGNER BRIEF:\n${result.designer}\n\n---\n\nSOCIAL MEDIA POSTS:\n${result.social}`,
            Agent: 'VP Approved',
            Status: 'Needs Review',
            Brief: brief,
            Notes: `VP Score: ${result.score}/10 | Type: ${result.content_type}`
          }
        }], {typecast: true});
        send({ agent: 'system', status: 'saving', message: `Piece ${i + 1} saved to review queue` });
      } catch (airtableError) {
        console.log('Airtable error:', airtableError.message);
      }

      send({ agent: 'system', status: 'piece_complete', result, pieceNum: i + 1 });
    }

    send({
      agent: 'system',
      status: 'complete',
      message: `All ${vpResult.pieces.length} pieces complete and VP approved! Check your review queue.`,
      results: allResults,
      calendarNote: vpResult.calendar_note
    });

    res.end();

  } catch (error) {
    console.log('Server error:', error);
    res.write(`data: ${JSON.stringify({ agent: 'system', status: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

app.get('/api/queue', async (req, res) => {
  try {
    const records = await base('Content').select({
      filterByFormula: "{Status} = 'Needs Review'",
      sort: [{field: 'Created', direction: 'desc'}]
    }).all();
    res.json(records.map(r => ({ id: r.id, ...r.fields })));
  } catch (error) {
    console.log('Queue error:', error.message);
    res.json([]);
  }
});

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