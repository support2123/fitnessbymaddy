const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendMediaTemplate, maskPhone } = require('./_lib/whatsapp');
const { notifyMaddy } = require('./_lib/escalation');
const { generateProgramPDF } = require('./_lib/pdf');

const SAFETY_FLAGS = [
  'below 1200 calories', 'under 1000 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedrine', 'sarms',
  'anabolic', 'steroid', 'testosterone', 'tren',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    // Get client
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Build the prompt
    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      totalWeeks: client.program === '12wk' ? 12 : 6,
    };

    const checkinSummary = (checkins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
    }));

    const prompt = buildPrompt(clientProfile, checkinSummary);

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    // Parse JSON from response
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      console.error('Failed to parse program JSON from Claude response');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const programData = JSON.parse(jsonMatch[1]);

    // Safety check
    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.filter(f => fullText.includes(f));
    if (flagged.length > 0) {
      await notifyMaddy(
        'Program safety flag',
        maskPhone(client.phone),
        `Week ${week_no}: ${flagged.join(', ')}`
      );
      return res.status(200).json({
        action: 'flagged_for_review',
        flags: flagged,
      });
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(
      client.name || 'Client',
      week_no,
      programData.workout_plan,
      programData.nutrition_plan,
      programData.notes
    );

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData.publicUrl;

    // Store in programs table
    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
    });

    // Send via WhatsApp
    const contextNote = programData.notes
      ? programData.notes.substring(0, 100)
      : `Week ${week_no} program ready!`;

    await sendMediaTemplate(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(week_no), contextNote],
      pdfUrl
    );

    // Update whatsapp_sent_at
    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      action: 'program_generated',
      week_no,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(profile, checkins) {
  const checkinText = checkins.length > 0
    ? checkins.map(c =>
      `Week ${c.week}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, ` +
      `Compliance ${c.compliance}/10, Energy ${c.energy}/10` +
      (c.issues ? `, Issues: ${c.issues}` : '')
    ).join('\n')
    : 'No previous check-ins (first week).';

  return `You are a certified personal trainer and nutrition coach designing Week ${profile.week} of ${profile.totalWeeks} for a client.

CLIENT: ${profile.name || 'Client'}
PROGRAM: ${profile.program}
WEEK: ${profile.week} of ${profile.totalWeeks}

RECENT CHECK-INS:
${checkinText}

RULES:
- Design a progressive, science-based program appropriate for this week
- Never recommend calories below 1400 for women or 1600 for men
- Never recommend banned substances or extreme protocols
- Adjust based on check-in data (compliance, energy, issues)
- If compliance is low, simplify. If energy is low, reduce volume slightly.
- Include warm-up and cool-down notes
- Be specific with sets, reps, rest times, and exercise names

Return ONLY a JSON block in this exact format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          {
            "name": "Barbell Bench Press",
            "sets": "4",
            "reps": "8-10",
            "rest": "90s",
            "notes": "Focus on controlled eccentric"
          }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein": 160,
    "carbs": 250,
    "fat": 65,
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "description": "4 egg whites + 1 whole egg scrambled, 1 cup oats with banana"
      }
    ]
  },
  "notes": "Brief coach note for the client about this week's focus"
}
\`\`\``;
}
