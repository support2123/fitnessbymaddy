const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendTemplate } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroids', 'anabolic',
  'lose 10kg in a week', 'crash diet', 'starvation'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    // Load client
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Load last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Build Claude prompt
    const prompt = buildProgramPrompt(client, checkins || [], week_no);

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawOutput = response.content[0].text;

    // Safety check
    const lowerOutput = rawOutput.toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (lowerOutput.includes(flag)) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy(
          `Risky program content detected: "${flag}"`,
          client.phone,
          `Week ${week_no} program flagged for review`
        );
        return res.status(200).json({
          success: false,
          reason: 'flagged_for_review',
          flag
        });
      }
    }

    // Parse JSON from Claude response
    let programData;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { workout_plan, nutrition_plan, notes } = programData;

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(client, week_no, workout_plan, nutrition_plan, notes);

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl;

    // Save to programs table (audit trail)
    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan,
      nutrition_plan,
      notes
    });

    // Send via WhatsApp
    const contextNote = notes
      ? notes.split('.')[0]
      : `Week ${week_no} program ready`;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      contextNote
    ]);

    // Update sent timestamp
    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let context = `You are a certified personal trainer and nutrition coach creating Week ${weekNo} of a personalized fitness program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${client.goal || 'General fitness'}
- Age: ${client.age || 'Not specified'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Flexible'}
`;

  if (lastCheckin) {
    context += `
LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
- Focus: ${lastCheckin.next_week_focus || 'Continue current plan'}
`;
  }

  if (prevCheckin) {
    context += `
PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10
`;
  }

  context += `
RULES:
- Create a safe, evidence-based program
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- If compliance was low, simplify the plan
- If energy was low, reduce volume slightly
- Progressive overload where appropriate

Return a JSON object with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fat": 67,
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": ["4 egg whites + 1 whole egg", "1 cup oats", "1 banana"]
      }
    ]
  },
  "notes": "One-liner coach note about this week's focus"
}

Return ONLY the JSON object, no other text.`;

  return context;
}
