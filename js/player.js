/**
 * player.js
 * ---------------------------------------------------------------------------
 * Everything about a single football player: attribute model, overall/
 * potential calculation, XP & progression, and squad generation used to
 * populate every club in the database with a realistic roster.
 * ---------------------------------------------------------------------------
 */

const PlayerModel = (() => {

  // Attribute weight profile per position — determines both the starting
  // overall calc and which attributes grow fastest for that role.
  const POSITION_WEIGHTS = {
    GOL:  { reflexo: .30, posicionamento: .20, defesa: .20, controle: .10, fisico: .10, resistencia: .10 },
    ZAG:  { marcacao: .25, interceptacao: .20, cabeceio: .15, fisico: .15, posicionamento: .15, velocidade: .10 },
    LE:   { velocidade: .20, marcacao: .15, cruzamento: .15, resistencia: .15, drible: .15, passe: .10, interceptacao: .10 },
    LD:   { velocidade: .20, marcacao: .15, cruzamento: .15, resistencia: .15, drible: .15, passe: .10, interceptacao: .10 },
    VOL:  { marcacao: .20, interceptacao: .20, passe: .15, fisico: .15, resistencia: .15, visao: .15 },
    MC:   { passe: .20, visao: .20, controle: .15, resistencia: .15, drible: .15, marcacao: .15 },
    MEIA: { drible: .20, visao: .20, passe: .15, finalizacao: .15, controle: .15, velocidade: .15 },
    PE:   { velocidade: .25, drible: .25, finalizacao: .15, cruzamento: .15, controle: .10, fisico: .10 },
    PD:   { velocidade: .25, drible: .25, finalizacao: .15, cruzamento: .15, controle: .10, fisico: .10 },
    ATA:  { finalizacao: .30, velocidade: .15, cabeceio: .15, drible: .15, fisico: .15, posicionamento: .10 },
  };

  const ALL_ATTRS = ['velocidade', 'finalizacao', 'passe', 'drible', 'fisico', 'cabeceio',
    'marcacao', 'interceptacao', 'reflexo', 'posicionamento', 'defesa', 'resistencia', 'controle', 'visao'];

  function randRange(min, max) { return Math.round(min + Math.random() * (max - min)); }

  // Overall band by starting age, per the spec (never overpowered rookies)
  function initialOverallRange(age) {
    if (age <= 16) return [45, 57];
    if (age === 17) return [48, 60];
    return [52, 65]; // 18
  }

  function buildAttributesForOverall(position, overall) {
    const weights = POSITION_WEIGHTS[position];
    const attrs = {};
    ALL_ATTRS.forEach(a => { attrs[a] = clamp(overall + randRange(-12, -4), 20, 99); });
    // Push weighted attributes up close to overall, with slight variance
    Object.keys(weights).forEach(a => {
      attrs[a] = clamp(overall + randRange(-3, 6), 20, 99);
    });
    return attrs;
  }

  function computeOverall(attrs, position) {
    const weights = POSITION_WEIGHTS[position];
    let sum = 0, wsum = 0;
    Object.entries(weights).forEach(([attr, w]) => { sum += (attrs[attr] || 50) * w; wsum += w; });
    // remaining attributes contribute a small baseline average
    const others = ALL_ATTRS.filter(a => !weights[a]);
    const otherAvg = others.reduce((s, a) => s + (attrs[a] || 50), 0) / others.length;
    const core = sum / wsum;
    return clamp(Math.round(core * 0.85 + otherAvg * 0.15), 1, 99);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // -----------------------------------------------------------------------
  // Creates the user's controllable career player
  // -----------------------------------------------------------------------
  function createCareerPlayer(form) {
    const [lo, hi] = initialOverallRange(form.age);
    const overall = randRange(lo, hi);
    const potential = clamp(overall + randRange(15, 30) - Math.max(0, form.age - 16) * 2, overall, 94);
    const attrs = buildAttributesForOverall(form.position, overall);
    return {
      id: 'career_' + Date.now(),
      isCareerPlayer: true,
      firstName: form.firstName, lastName: form.lastName,
      name: `${form.firstName} ${form.lastName}`,
      age: form.age, nationality: form.nationality, foot: form.foot,
      height: form.height, weight: form.weight, position: form.position,
      attributes: attrs, overall: computeOverall(attrs, form.position), potential,
      xp: 0, xpToNext: 100, level: 1,
      form: 70, // 0-100 recent performance form
      morale: 75, // 0-100
      popularity: 20, // 0-100 fan/press popularity
      fitness: 100, // 0-100 fatigue inverse
      injury: null, // { type, weeksLeft }
      contract: null, // set on joining a club
      marketValue: estimateMarketValue(overall, potential, form.age),
      caps: 0, goalsNT: 0, // national team
      history: [], // season-by-season stats log
      seasonStats: freshSeasonStats(),
      trophies: [],
      skills: [], // unlocked special abilities
    };
  }

  function freshSeasonStats() {
    return { matches: 0, goals: 0, assists: 0, avgRating: 0, ratingSum: 0, yellow: 0, red: 0, motm: 0 };
  }

  function estimateMarketValue(overall, potential, age) {
    const base = Math.pow(1.09, overall - 50) * 400000;
    const potentialBoost = 1 + (potential - overall) * 0.03;
    const ageFactor = age <= 21 ? 1.3 : age <= 27 ? 1.1 : age <= 31 ? 0.85 : 0.5;
    return Math.round((base * potentialBoost * ageFactor) / 5000) * 5000;
  }

  // -----------------------------------------------------------------------
  // Squad generation for CPU clubs — realistic depth, age curve & overalls
  // scaled to club reputation.
  // -----------------------------------------------------------------------
  function generateSquad(clubObj) {
    const squad = [];
    const depthByPos = { GOL: 3, ZAG: 4, LE: 2, LD: 2, VOL: 3, MC: 3, MEIA: 2, PE: 2, PD: 2, ATA: 3 };
    const baseOverall = clubObj.reputation;
    Object.entries(depthByPos).forEach(([pos, count]) => {
      for (let i = 0; i < count; i++) {
        const age = randRange(18, 34);
        const variance = randRange(-9, 6) - (i * 3); // starters stronger than depth
        const overall = clamp(baseOverall + variance, 45, 92);
        const potential = age < 24 ? clamp(overall + randRange(0, 12), overall, 94) : overall;
        const attrs = buildAttributesForOverall(pos, overall);
        const nationality = pick(nationalityPoolForLeague(clubObj.league));
        const fn = DB.randomPlayerName(nationality).split(' ');
        squad.push({
          id: `${clubObj.id}_${pos}_${i}_${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`,
          firstName: fn[0], lastName: fn.slice(1).join(' '),
          name: `${fn[0]} ${fn.slice(1).join(' ')}`,
          age, nationality, position: pos,
          attributes: attrs, overall: computeOverall(attrs, pos), potential,
          marketValue: estimateMarketValue(overall, potential, age),
          salary: Math.round(overall * overall * 80),
          clubId: clubObj.id, isStarter: i === 0,
          form: randRange(55, 85), fitness: 100, injury: null,
        });
      }
    });
    return squad;
  }

  function nationalityPoolForLeague(leagueCode) {
    const home = DB.LEAGUES[leagueCode] ? DB.LEAGUES[leagueCode].country : 'Outra';
    // Mostly domestic players, some international mix
    return [home, home, home, home, home, home, 'Brasil', 'Argentina', 'França', 'Outra'];
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // -----------------------------------------------------------------------
  // XP / progression
  // -----------------------------------------------------------------------
  function grantXP(player, amount) {
    player.xp += amount;
    const gains = [];
    while (player.xp >= player.xpToNext) {
      player.xp -= player.xpToNext;
      player.level += 1;
      player.xpToNext = Math.round(player.xpToNext * 1.12);
      const gained = growAttributes(player);
      gains.push(gained);
      maybeUnlockSkill(player);
    }
    player.overall = computeOverall(player.attributes, player.position);
    player.marketValue = estimateMarketValue(player.overall, player.potential, player.age);
    return gains;
  }

  function growAttributes(player) {
    const weights = POSITION_WEIGHTS[player.position];
    const keys = Object.keys(weights);
    const gained = {};
    const room = player.potential - player.overall;
    const growth = room > 0 ? randRange(1, 3) : 0;
    for (let i = 0; i < growth; i++) {
      const attr = keys[Math.floor(Math.random() * keys.length)];
      if (player.attributes[attr] < 99) {
        player.attributes[attr] = clamp(player.attributes[attr] + 1, 1, 99);
        gained[attr] = (gained[attr] || 0) + 1;
      }
    }
    return gained;
  }

  const SKILL_POOL = [
    'Finalização Colocada', 'Chute de Fora da Área', 'Cabeceio de Precisão', 'Drible Curto',
    'Passe Milimétrico', 'Pênalti Especialista', 'Cobrança de Falta', 'Velocista',
    'Marcação Implacável', 'Saída de Bola Limpa', 'Visão de Jogo Elite', 'Liderança em Campo',
  ];
  function maybeUnlockSkill(player) {
    if (player.level % 3 === 0 && player.skills.length < SKILL_POOL.length) {
      const available = SKILL_POOL.filter(s => !player.skills.includes(s));
      if (available.length) player.skills.push(pick(available));
    }
  }

  return {
    POSITION_WEIGHTS, ALL_ATTRS, createCareerPlayer, generateSquad, computeOverall,
    estimateMarketValue, grantXP, freshSeasonStats, clamp,
  };
})();
