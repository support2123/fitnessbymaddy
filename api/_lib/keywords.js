/**
 * Program keyword rules — each entry maps a set of trigger words to a
 * program slug.  Order matters: the first match wins.
 */
const RULES = [
  {
    keywords: ["fat loss", "weight", "shred", "lose", "burn", "slim"],
    program: "6wk_gym",
  },
  {
    keywords: ["pcos", "hormonal", "hormone", "period", "thyroid"],
    program: "pcos",
  },
  {
    keywords: ["40", "menopause", "joints", "senior", "old"],
    program: "40plus",
  },
  {
    keywords: ["custom", "12 week", "serious", "personali", "flagship"],
    program: "12wk",
  },
  {
    keywords: ["trial", "zoom", "not sure", "try", "test"],
    program: "zoom_trial",
  },
  {
    keywords: ["home", "no gym", "bodyweight"],
    program: "6wk_home",
  },
];

/**
 * Classify a lead's message into a program interest.
 *
 * @param {string} message  The raw message text from the lead
 * @returns {{ program: string|null, confidence: 'high'|'low' }}
 */
function classifyIntent(message) {
  if (!message) return { program: null, confidence: "low" };

  const lower = message.toLowerCase();
  let matchCount = 0;
  let matchedProgram = null;

  for (const rule of RULES) {
    const hits = rule.keywords.filter((kw) => lower.includes(kw));
    if (hits.length > 0) {
      // First match becomes the candidate; count total keyword hits
      if (!matchedProgram) {
        matchedProgram = rule.program;
      }
      matchCount += hits.length;
    }
  }

  if (!matchedProgram) {
    return { program: null, confidence: "low" };
  }

  // Two or more keyword hits within the same first-matched rule = high confidence
  const firstRule = RULES.find((r) => r.program === matchedProgram);
  const firstRuleHits = firstRule.keywords.filter((kw) => lower.includes(kw));

  return {
    program: matchedProgram,
    confidence: firstRuleHits.length >= 2 ? "high" : "low",
  };
}

module.exports = { classifyIntent };
