const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendMessage } = require('../lib/whatsapp');
const { generateProgramPDF, uploadPDF } = require('../lib/pdf');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroids', 'anabolic', 'sarms',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for weight loss',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Fetch client
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Fetch last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Build prompt
    const clientProfile = {
      name: client.name,
      program: client.program,
      weekNumber: week_no,
      intake: client.intake_data || {},
      recentCheckins: (checkins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues,
        focus: c.next_week_focus,
      })),
    };

    const systemPrompt = `You are an expert fitness program architect for FitnessByMaddy. You create personalized weekly workout and nutrition plans based on client data.

RULES:
- Create safe, evidence-based programs
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or dangerous supplements
- Adjust based on compliance scores and reported issues
- Be progressive: increase volume/intensity gradually
- Consider reported injuries and energy levels
- Output ONLY valid JSON with no additional text`;

    const userPrompt = `Generate Week ${week_no} program for this client:

${JSON.stringify(clientProfile, null, 2)}

Output JSON format:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "RPE 7-8" }
        ]
      }
    ],
    "restDays": "Wednesday, Sunday",
    "cardio": "20min LISS on rest days"
  },
  "nutrition": {
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "description": "Oats with protein powder and berries",
        "macros": { "protein": 35, "carbs": 45, "fat": 12 }
      }
    ],
    "dailyTotals": { "calories": 2000, "protein": 150, "carbs": 200, "fat": 65 },
    "hydration": "3-4 litres water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Multivitamin"]
  },
  "coachNotes": "Focus on progressive overload this week. Energy was low last week, so added an extra rest day."
}`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawOutput = response.content[0].text;

    // Safety check
    if (hasSafetyIssue(rawOutput)) {
      await escalateToMaddy('Program generation flagged for safety review', {
        phone: client.phone,
        name: client.name,
        messageBody: `Week ${week_no} program flagged. Review needed before sending.`,
      });

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: { flagged: true },
        nutrition_plan: { flagged: true },
        notes: 'FLAGGED FOR SAFETY REVIEW — not auto-sent',
      });

      return res.status(200).json({ ok: true, action: 'flagged_for_review' });
    }

    // Parse JSON
    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch {
      console.error('Failed to parse Claude output');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { workout, nutrition, coachNotes } = parsed;

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(client, week_no, workout, nutrition, coachNotes);
    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    // Store in programs table (audit trail)
    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workout,
      nutrition_plan: nutrition,
      notes: coachNotes,
    });

    // Send via WhatsApp
    const contextNote = coachNotes
      ? `📋 Week ${week_no} Plan Ready!\n\n${coachNotes}\n\nPDF: ${pdfUrl}`
      : `📋 Your Week ${week_no} program is ready!\n\nPDF: ${pdfUrl}`;

    await sendMessage(client.phone, { text: contextNote, isClient: true });

    // Update whatsapp_sent_at
    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
