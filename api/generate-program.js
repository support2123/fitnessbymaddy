const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { isHinglish } = require('./_lib/market');
const { generateProgramPdf } = require('./_lib/pdf');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800',
  'clenbuterol', 'dnp', 'ephedra', 'sarm', 'steroid',
  'lose 10kg in 1 week', 'crash diet', 'water fast',
  'fat burner pill', 'detox tea'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a program architect for FitnessByMaddy, an elite online fitness coaching brand.
You create weekly workout and nutrition plans that are:
- Science-based and progressive
- Tailored to the client's profile, goals, and recent check-in data
- Safe and sustainable (no extreme calorie cuts, no banned substances, no unrealistic timelines)
- Warm, expert tone — never bro-sciency

Output ONLY valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 73 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "4 egg whites + 1 whole egg scrambled with spinach, 1 cup oats with berries" }
    ]
  },
  "notes": "Coach note for the client about this week's focus."
}`;

    const clientProfile = {
      name: client.name,
      program: client.program,
      age: client.age,
      goal: client.goal,
      injuries: client.injuries,
      diet_pref: client.diet_pref,
      schedule: client.schedule,
      week: week_no
    };

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const userPrompt = `Create Week ${week_no} program for this client:

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${checkinSummary.length > 0 ? JSON.stringify(checkinSummary, null, 2) : 'No check-ins yet (first week).'}

${lastProgram ? `LAST WEEK'S FOCUS: ${lastProgram.notes || 'General progression'}` : ''}

Design a progressive, personalized week. ${week_no === 1 ? 'This is their first week — start with a foundation phase.' : `Build on week ${week_no - 1} with appropriate progression.`}
${client.injuries ? `IMPORTANT: Client has noted injuries/limitations: ${client.injuries}. Program around these safely.` : ''}
${client.diet_pref ? `Diet preference: ${client.diet_pref}` : ''}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      await notifyMaddy('Program Generation Failed', `Could not parse AI response for ${client.name || client_id}, Week ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (fullText.includes(flag)) {
        await notifyMaddy(
          'Program Safety Flag',
          `Week ${week_no} for ${client.name || client_id} flagged: "${flag}". Review before sending.`
        );
        await supabase.from('programs').insert({
          client_id,
          week_no,
          workout_plan: parsed.workout_plan,
          nutrition_plan: parsed.nutrition_plan,
          notes: `[FLAGGED: ${flag}] ${parsed.notes || ''}`
        });
        return res.status(200).json({ ok: true, flagged: true, reason: flag });
      }
    }

    let pdfUrl = null;
    try {
      const pdfBuffer = await generateProgramPdf(client, week_no, parsed.workout_plan, parsed.nutrition_plan, parsed.notes);

      const filePath = `clients/${client_id}/week_${week_no}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from('programs')
        .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('programs').getPublicUrl(filePath);
        pdfUrl = urlData.publicUrl;
      }
    } catch (pdfErr) {
      console.error('PDF generation/upload failed:', pdfErr.message);
    }

    await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
      pdf_url: pdfUrl,
      whatsapp_sent_at: new Date().toISOString()
    });

    const market = require('./_lib/market').detectMarket(client.phone);
    const templateName = isHinglish(market) ? 'weekly_program_hi' : 'weekly_program_en';
    await sendTemplate(client.phone, templateName, [client.name || 'there', String(week_no), pdfUrl || 'PDF being prepared'], client.name);

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
