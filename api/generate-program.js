const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendText, maskPhone } = require('./_lib/whatsapp');
const { PROGRAMS } = require('./_lib/constants');

const INTERNAL_KEY = process.env.INTERNAL_API_KEY;

/** Words/phrases that flag a program for manual review. */
const BANNED_TERMS = [
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'anabolic steroid',
  'testosterone injection', 'trenbolone', 'sarm', 'hgh injection',
];

/**
 * POST /api/generate-program
 * Body: { client_id, week_no }
 * Header: x-internal-key
 *
 * Generates a personalised weekly program using Claude, saves it,
 * and sends a summary via WhatsApp.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify internal key
  const key = req.headers['x-internal-key'];
  if (key !== INTERNAL_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body || {};
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  try {
    // ── 1. Fetch client data (joined with lead profile) ──
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*, leads(*)')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      console.error('[generate-program] Client not found:', clientErr?.message);
      return res.status(404).json({ error: 'Client not found' });
    }

    // ── 2. Fetch last 2 check-ins ──
    const { data: checkins, error: checkinErr } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (checkinErr) {
      console.error('[generate-program] Failed to fetch check-ins:', checkinErr.message);
    }

    // ── 3. Build Claude prompt ──
    const lead = client.leads || {};
    const programMeta = PROGRAMS[client.program] || {};

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy. Create personalized weekly workout and nutrition plans based on client data. Never recommend extreme calorie restrictions (<1200 cal for women, <1500 for men), banned substances, or unrealistic timelines. Output JSON with workout_plan and nutrition_plan fields.`;

    const userPrompt = `Generate a personalised program for Week ${week_no}.

**Client Profile:**
- Name: ${client.name}
- Age: ${lead.age || 'unknown'}
- Gender: ${lead.gender || 'unknown'}
- Weight: ${lead.weight || 'unknown'}
- Goal: ${lead.goal || client.goal || 'general fitness'}
- Injuries/Conditions: ${lead.injuries || 'none reported'}
- Diet Preference: ${lead.diet_preference || 'no restriction'}

**Program:** ${programMeta.name || client.program_type} (${programMeta.duration || client.duration || '?'} days)

**Last check-ins:**
${checkins && checkins.length > 0 ? checkins.map((c) => `- Week ${c.week_no}: weight=${c.weight || '?'}, energy=${c.energy_level || '?'}, compliance=${c.compliance || '?'}, notes="${c.notes || ''}"`).join('\n') : 'No prior check-ins available.'}

**Current Week:** ${week_no}

Return ONLY valid JSON with two top-level keys:
{
  "workout_plan": { ... },
  "nutrition_plan": { ... }
}`;

    // ── 4. Call Claude API ──
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      system: systemPrompt,
    });

    const rawText = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    // ── 5. Parse response JSON ──
    let plans;
    try {
      // Handle possible markdown code fences
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
      plans = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[generate-program] Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    if (!plans.workout_plan || !plans.nutrition_plan) {
      console.error('[generate-program] Missing plan fields in Claude response');
      return res.status(500).json({ error: 'Incomplete program generated' });
    }

    // ── 6. Safety check ──
    const outputLower = rawText.toLowerCase();
    const flaggedTerms = BANNED_TERMS.filter((term) => outputLower.includes(term));

    // Check for extreme calorie restrictions
    const calMatch = outputLower.match(/(\d{3,4})\s*(?:cal|kcal)/g);
    if (calMatch) {
      for (const m of calMatch) {
        const num = parseInt(m, 10);
        const gender = (lead.gender || '').toLowerCase();
        if (gender === 'female' && num < 1200) flaggedTerms.push(`low-cal:${num}`);
        if (gender === 'male' && num < 1500) flaggedTerms.push(`low-cal:${num}`);
      }
    }

    if (flaggedTerms.length > 0) {
      console.warn(`[generate-program] FLAGGED for review — client ${client_id}, terms: ${flaggedTerms.join(', ')}`);

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: plans.workout_plan,
        nutrition_plan: plans.nutrition_plan,
        flagged_for_review: true,
        review_reason: flaggedTerms.join(', '),
        generated_at: new Date().toISOString(),
      });

      return res.status(200).json({
        success: false,
        flagged: true,
        flagged_terms: flaggedTerms,
        message: 'Program flagged for manual review',
      });
    }

    // ── 7. Generate text summary ──
    const summary = buildTextSummary(client.name, week_no, plans);

    // ── 8. Upload text summary to Supabase storage ──
    const filePath = `clients/${client_id}/week_${week_no}.txt`;
    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(filePath, Buffer.from(summary, 'utf-8'), {
        contentType: 'text/plain',
        upsert: true,
      });

    if (uploadErr) {
      console.error('[generate-program] Storage upload failed:', uploadErr.message);
      // Non-fatal — continue saving to DB
    }

    // ── 9. Save to programs table ──
    const { data: program, error: insertErr } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: plans.workout_plan,
        nutrition_plan: plans.nutrition_plan,
        generated_at: new Date().toISOString(),
        whatsapp_sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[generate-program] DB insert failed:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    // ── 10. Send program via WhatsApp ──
    const whatsappMsg = `Hey ${client.name}! Your Week ${week_no} program is ready.\n\n${summary}\n\nLet me know if you have any questions!`;
    const sendResult = await sendText(client.phone, whatsappMsg);

    if (sendResult.success) {
      console.log(`[generate-program] Program sent to ${maskPhone(client.phone)} (week ${week_no})`);
    } else {
      console.error(`[generate-program] WhatsApp send failed for ${maskPhone(client.phone)}`);
    }

    return res.status(200).json({
      success: true,
      program_id: program.id,
    });
  } catch (err) {
    console.error('[generate-program] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Build a human-readable text summary of the weekly program.
 */
function buildTextSummary(name, weekNo, plans) {
  const lines = [];
  lines.push(`=== FitnessByMaddy — Week ${weekNo} Program for ${name} ===`);
  lines.push('');

  // Workout plan summary
  lines.push('--- WORKOUT PLAN ---');
  const wp = plans.workout_plan;
  if (typeof wp === 'object') {
    for (const [day, details] of Object.entries(wp)) {
      if (typeof details === 'string') {
        lines.push(`${day}: ${details}`);
      } else if (typeof details === 'object') {
        lines.push(`${day}:`);
        if (Array.isArray(details.exercises || details)) {
          const exercises = details.exercises || details;
          for (const ex of exercises) {
            if (typeof ex === 'string') {
              lines.push(`  - ${ex}`);
            } else {
              lines.push(`  - ${ex.name || ex.exercise || JSON.stringify(ex)}`);
            }
          }
        } else {
          lines.push(`  ${JSON.stringify(details)}`);
        }
      }
    }
  } else {
    lines.push(String(wp));
  }

  lines.push('');
  lines.push('--- NUTRITION PLAN ---');
  const np = plans.nutrition_plan;
  if (typeof np === 'object') {
    for (const [key, value] of Object.entries(np)) {
      if (typeof value === 'string') {
        lines.push(`${key}: ${value}`);
      } else if (Array.isArray(value)) {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${typeof item === 'string' ? item : JSON.stringify(item)}`);
        }
      } else if (typeof value === 'object') {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      }
    }
  } else {
    lines.push(String(np));
  }

  lines.push('');
  lines.push('Questions? Just reply to this message!');
  return lines.join('\n');
}
