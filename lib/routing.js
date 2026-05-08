const PROGRAM_MAP = {
  fat_loss: {
    program: "6wk_gym",
    name: "6-Week Burn & Build",
    price: 97,
    checkoutPath: "6wk-burn-build",
  },
  pcos: {
    program: "pcos",
    name: "PCOS Warrior",
    price: 45,
    checkoutPath: "pcos-warrior",
  },
  fortyplus: {
    program: "40plus",
    name: "40+ Strong",
    price: 50,
    checkoutPath: "40plus-strong",
  },
  flagship: {
    program: "12wk",
    name: "12-Week Flagship",
    price: 200,
    checkoutPath: "12wk-flagship",
  },
  trial: {
    program: "zoom_trial",
    name: "Zoom Trial Session",
    price: 20,
    checkoutPath: "zoom-trial",
  },
};

function routeByKeyword(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/fat\s?loss|weight|shred|lean|cut/.test(lower)) return PROGRAM_MAP.fat_loss;
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return PROGRAM_MAP.pcos;
  if (/\b40|menopause|joints|senior|mature/.test(lower)) return PROGRAM_MAP.fortyplus;
  if (/custom|12\s?week|serious|flagship|transform/.test(lower)) return PROGRAM_MAP.flagship;
  if (/trial|zoom|not sure|try|test/.test(lower)) return PROGRAM_MAP.trial;

  return null;
}

module.exports = { routeByKeyword, PROGRAM_MAP };
