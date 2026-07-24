/**
 * events.js
 * ---------------------------------------------------------------------------
 * Builds a full 90-minute match timeline: ambient goals/commentary for both
 * sides plus the career player's own decision moments, all minute-stamped
 * and sorted so career.js/ui.js can play it back like a live match ticker.
 *
 * Every goal — ambient, scored, or assisted — is logged as an explicit
 * timeline event that increments the live score right then. There is no
 * separate "final score" computed afterwards from a different formula, so
 * an assist (or a goal) can never fail to show up on the scoreboard.
 * ---------------------------------------------------------------------------
 */

const Events = (() => {

  function clamp01(v) { return Math.max(0.03, Math.min(0.96, v)); }
  function derived(attrs) { return Object.assign({}, attrs, { cruzamento_eff: (attrs.controle + attrs.velocidade) * 0.04 }); }
  function uid() { return Math.random().toString(36).slice(2, 9); }

  // =========================================================================
  // DECISION DEFINITIONS — each option is explicitly tagged with what it
  // does to the score/scoreline if it succeeds, so the timeline engine never
  // has to guess. Shooting chances scale steeply with the relevant
  // attribute — a genuinely great finisher should convert most clear
  // chances, not roughly a coin flip.
  // =========================================================================
  const DECISIONS = {
    cara_a_cara: {
      prompt: 'Cara a cara com o goleiro! Como você finaliza?',
      options: [
        { key: 'forte', label: '💥 Chute forte', outcome: 'goal', chance: a => 0.48 + (a.finalizacao - 60) * 0.010, succ: 'bateu forte e estufou a rede!', fail: 'chutou forte, mas para fora.' },
        { key: 'cavada', label: '🪁 Cavada por cima', outcome: 'goal', chance: a => 0.40 + (a.drible - 60) * 0.010, succ: 'cavou a bola com categoria, sem chances para o goleiro!', fail: 'tentou a cavadinha, mas mandou por cima do travessão.' },
        { key: 'rasteiro', label: '🎯 Chute rasteiro no canto', outcome: 'goal', chance: a => 0.53 + (a.controle - 60) * 0.009, succ: 'bateu rasteiro no cantinho, sem chances!', fail: 'chutou rasteiro, mas o goleiro defendeu.' },
      ],
    },
    chance_clara: {
      prompt: 'Grande chance na área! Qual a decisão?',
      options: [
        { key: 'primeira', label: '⚡ Finalizar de primeira', outcome: 'goal', chance: a => 0.42 + (a.finalizacao - 60) * 0.010, succ: 'finalizou de primeira, gol!', fail: 'finalizou de primeira, mas a bola foi por cima.' },
        { key: 'ajeitar', label: '🎯 Ajeitar e bater', outcome: 'goal', chance: a => 0.50 + (a.controle - 60) * 0.009, succ: 'ajeitou e bateu no cantinho, gol!', fail: 'ajeitou para finalizar, mas a zaga cortou.' },
        { key: 'cruzar', label: '🅰️ Cruzar para o companheiro', outcome: 'assist', chance: a => 0.55 + (a.passe - 60) * 0.009, succ: 'cruzou e o companheiro só empurrou para o gol!', fail: 'cruzou, mas a defesa afastou o perigo.' },
      ],
    },
    penalti: {
      prompt: 'Pênalti! Para onde você bate?',
      options: [
        { key: 'esquerda', label: '⬅️ Canto esquerdo', outcome: 'goal', chance: a => 0.76 + (a.finalizacao - 60) * 0.005, succ: 'cobrou no canto esquerdo, gol!', fail: 'bateu no canto esquerdo, o goleiro pegou!' },
        { key: 'direita', label: '➡️ Canto direito', outcome: 'goal', chance: a => 0.76 + (a.finalizacao - 60) * 0.005, succ: 'cobrou no canto direito, gol!', fail: 'bateu no canto direito, o goleiro pegou!' },
        { key: 'meio', label: '⬆️ Meio do gol (cavadinha)', outcome: 'goal', chance: a => 0.65 + (a.controle - 60) * 0.006, succ: 'cavou no meio do gol, o goleiro caiu para o lado, gol!', fail: 'tentou a cavadinha no meio, o goleiro ficou no meio e defendeu!' },
      ],
    },
    ultimo_passe: {
      prompt: 'Espaço para o passe final! Qual a escolha?',
      options: [
        { key: 'curto', label: '🎯 Passe seguro no pé', outcome: 'assist', chance: a => 0.58 + (a.passe - 60) * 0.009, succ: 'tocou preciso e o companheiro só empurrou para o gol!', fail: 'o passe saiu forte demais e a zaga cortou.' },
        { key: 'lancamento', label: '🚀 Lançamento por cima', outcome: 'assist', chance: a => 0.42 + (a.visao - 60) * 0.009, succ: 'lançou com precisão cirúrgica, assistência para o gol!', fail: 'o lançamento saiu longo demais e a defesa afastou.' },
        { key: 'cruzamento', label: '↗️ Cruzamento na área', outcome: 'assist', chance: a => 0.45 + (a.cruzamento_eff - 4) * 0.06, succ: 'cruzou na medida e o companheiro cabeceou para o gol!', fail: 'cruzou, mas a zaga cortou antes do companheiro.' },
      ],
    },
    bola_dividida: {
      prompt: 'Bola dividida na entrada da área! Como você ataca a jogada?',
      options: [
        { key: 'carrinho', label: '🦵 Carrinho', outcome: 'save', chance: a => 0.50 + (a.marcacao - 60) * 0.007, succ: 'chegou no carrinho e tirou a bola com categoria!', fail: 'chegou atrasado no carrinho e cometeu falta perigosa.', cardRisk: 0.45 },
        { key: 'corpo', label: '💪 Disputa de corpo', outcome: 'save', chance: a => 0.52 + (a.fisico - 60) * 0.007, succ: 'venceu a disputa de corpo e afastou o perigo!', fail: 'perdeu a disputa física e o adversário ficou com a bola.' },
        { key: 'recuo', label: '🧤 Recuar e proteger o gol', outcome: 'neutral', chance: a => 0.75 + (a.posicionamento - 60) * 0.004, succ: 'jogou com segurança e neutralizou o contra-ataque.', fail: 'recuou, mas ainda assim foi superado na jogada.' },
      ],
    },
    penalti_contra: {
      prompt: 'Pênalti contra o seu time! Para onde você se joga?',
      options: [
        { key: 'esquerda', label: '⬅️ Pular para a esquerda', outcome: 'save', chance: a => 0.32 + (a.reflexo - 60) * 0.008, succ: 'DEFENDEU! Adivinhou o canto e fez a defesa!', fail: 'pulou para a esquerda, mas a bola foi para o outro canto.' },
        { key: 'direita', label: '➡️ Pular para a direita', outcome: 'save', chance: a => 0.32 + (a.reflexo - 60) * 0.008, succ: 'DEFENDEU! Adivinhou o canto e fez a defesa!', fail: 'pulou para a direita, mas a bola foi para o outro canto.' },
        { key: 'meio', label: '⬆️ Ficar no meio do gol', outcome: 'save', chance: a => 0.24 + (a.posicionamento - 60) * 0.007, succ: 'ficou parado no meio e defendeu o pênalti!', fail: 'ficou no meio, mas o batedor bateu no canto e marcou.' },
      ],
    },
    cara_a_cara_defesa: {
      prompt: 'Atacante adversário sai cara a cara com você! Qual a reação?',
      options: [
        { key: 'sair', label: '⚡ Sair no pé do atacante', outcome: 'save', chance: a => 0.46 + (a.reflexo - 60) * 0.008, succ: 'saiu no momento certo e tirou a bola do atacante!', fail: 'saiu do gol, mas o atacante driblou e marcou.' },
        { key: 'linha', label: '🧱 Ficar na linha, reduzir ângulo', outcome: 'save', chance: a => 0.52 + (a.posicionamento - 60) * 0.008, succ: 'fechou bem o ângulo e defendeu o chute!', fail: 'reduziu o ângulo, mas o chute passou por baixo.' },
        { key: 'blefe', label: '🎭 Blefar a saída', outcome: 'save', chance: a => 0.40 + (a.reflexo + a.posicionamento - 120) * 0.005, succ: 'confundiu o atacante, que finalizou para fora!', fail: 'o blefe não funcionou e o atacante bateu cruzado, gol.' },
      ],
    },
  };

  // =========================================================================
  // AUTOMATIC (non-decision) FLAVOR EVENTS — quick to resolve, no prompt.
  // =========================================================================
  function autoOutcome(text, mood, extra) { return () => Object.assign({ text, mood, outcome: 'neutral' }, extra); }

  function cardAuto(ctx) {
    const red = Math.random() < 0.1;
    if (red) { ctx.stats.red = (ctx.stats.red || 0) + 1; return { text: '🟥 CARTÃO VERMELHO! Expulsão!', mood: -3, outcome: 'neutral' }; }
    ctx.stats.yellow = (ctx.stats.yellow || 0) + 1;
    return { text: '🟨 Cartão amarelo.', mood: -1, outcome: 'neutral' };
  }

  function injuryAuto(ctx) {
    const types = [
      { name: 'Contusão muscular', weeks: [1, 2] }, { name: 'Entorse no tornozelo', weeks: [2, 4] },
      { name: 'Lesão no joelho', weeks: [4, 10] }, { name: 'Fadiga muscular', weeks: [1, 1] },
    ];
    const t = types[Math.floor(Math.random() * types.length)];
    const weeks = t.weeks[0] + Math.floor(Math.random() * (t.weeks[1] - t.weeks[0] + 1));
    ctx.injury = { type: t.name, weeksLeft: weeks };
    return { text: `🚑 Sentiu uma lesão: ${t.name} (${weeks} semana(s) fora).`, mood: -2, outcome: 'neutral' };
  }

  function ownGoalAuto(ctx) { return { text: '😖 Gol contra! A bola desviou e entrou.', mood: -2.5, outcome: 'concede' }; }
  function keeperErrorAuto() { return { text: '😬 Falhou na saída e o adversário aproveitou.', mood: -2.5, outcome: 'concede' }; }
  function keeperSaveAuto() { return { text: '🧤 Fez uma defesa espetacular!', mood: 2, outcome: 'save' }; }

  // =========================================================================
  // POSITION POOLS
  // =========================================================================
  const POOLS = {
    ATA: [
      d('cara_a_cara', a => 4 + a.finalizacao * 0.07),
      d('chance_clara', a => 6 + a.posicionamento * 0.1),
      d('penalti', a => 1.2),
      auto('contra_ataque', a => 3 + a.velocidade * 0.05, autoOutcome('Puxou um contra-ataque perigoso.', 0.8)),
      auto('drible', a => 3 + a.drible * 0.06, autoOutcome('Driblou dois marcadores em jogada de efeito.', 0.7)),
      auto('falta_sofrida', a => 3, autoOutcome('Sofreu uma falta perigosa na entrada da área.', 0.4)),
      auto('cartao', a => 1.4, cardAuto),
      auto('lesao', a => 0.7, injuryAuto),
    ],
    PE: attackWide(), PD: attackWide(),
    MEIA: [
      d('chance_clara', a => 4 + a.finalizacao * 0.06),
      d('ultimo_passe', a => 6 + a.visao * 0.08),
      auto('drible', a => 4 + a.drible * 0.07, autoOutcome('Desequilibrou a marcação com um drible curto.', 0.6)),
      auto('roubo_bola', a => 3 + a.marcacao * 0.05, autoOutcome('Recuperou a posse no meio-campo.', 0.5)),
      auto('cartao', a => 1.3, cardAuto),
      auto('lesao', a => 0.7, injuryAuto),
    ],
    MC: [
      d('ultimo_passe', a => 5 + a.visao * 0.08),
      auto('roubo_bola', a => 6 + a.marcacao * 0.08, autoOutcome('Cortou o contra-ataque adversário no meio-campo.', 0.7)),
      auto('lancamento', a => 3 + a.passe * 0.05, autoOutcome('Trocou o lado do jogo com um lançamento preciso.', 0.5)),
      d('chance_clara', a => 2 + a.finalizacao * 0.03),
      auto('cartao', a => 1.5, cardAuto),
      auto('lesao', a => 0.7, injuryAuto),
    ],
    VOL: [
      auto('roubo_bola', a => 7 + a.interceptacao * 0.09, autoOutcome('Desarmou o adversário no meio-campo.', 0.6)),
      d('ultimo_passe', a => 3 + a.passe * 0.05),
      d('bola_dividida', a => 3 + a.marcacao * 0.04),
      auto('cartao', a => 2.3, cardAuto),
      auto('lesao', a => 0.7, injuryAuto),
    ],
    LE: flankDefender(), LD: flankDefender(),
    ZAG: [
      d('bola_dividida', a => 6 + a.marcacao * 0.07),
      auto('interceptacao', a => 6 + a.interceptacao * 0.09, autoOutcome('Interceptou o passe adversário com categoria.', 0.6)),
      auto('disputa_aerea', a => 4 + a.cabeceio * 0.06, autoOutcome('Venceu a disputa aérea dentro da área.', 0.5)),
      auto('gol_contra', a => 0.5, ownGoalAuto),
      auto('cartao', a => 2.8, cardAuto),
      auto('lesao', a => 0.7, injuryAuto),
    ],
    GOL: [
      d('penalti_contra', a => 1.2),
      d('cara_a_cara_defesa', a => 4 + a.reflexo * 0.05),
      auto('defesa_dificil', a => 8 + a.reflexo * 0.09, keeperSaveAuto),
      auto('saida_de_gol', a => 4 + a.posicionamento * 0.05, autoOutcome('Saiu bem do gol para cortar o cruzamento.', 0.5)),
      auto('erro', a => 2.2 - a.reflexo * 0.01, keeperErrorAuto),
      auto('lesao', a => 0.5, injuryAuto),
    ],
  };

  function attackWide() {
    return [
      d('cara_a_cara', a => 3 + a.finalizacao * 0.05),
      d('chance_clara', a => 4 + a.posicionamento * 0.07),
      d('ultimo_passe', a => 4 + a.passe * 0.05),
      auto('drible', a => 5 + a.drible * 0.08, autoOutcome('Encarou o marcador e levou a melhor no drible.', 0.7)),
      auto('cartao', a => 1.2, cardAuto),
      auto('lesao', a => 0.7, injuryAuto),
    ];
  }
  function flankDefender() {
    return [
      d('ultimo_passe', a => 3 + a.cruzamento_eff * 1.2),
      d('bola_dividida', a => 4 + a.marcacao * 0.05),
      auto('interceptacao', a => 4 + a.interceptacao * 0.06, autoOutcome('Interceptou o avanço adversário pela linha de fundo.', 0.5)),
      auto('cartao', a => 1.8, cardAuto),
      auto('lesao', a => 0.7, injuryAuto),
    ];
  }

  function d(key, weightFn) { return { key, weightFn, type: 'decision' }; }
  function auto(key, weightFn, resolve) { return { key, weightFn, type: 'auto', resolve }; }

  // =========================================================================
  // AMBIENT FLAVOR LINES — no gameplay effect, just keep the ticker feeling
  // alive between the meaningful events (New Star Soccer-style density).
  // =========================================================================
  const FLAVOR_LINES = [
    'Escanteio para o {team}.', 'Bola na trave! Que susto para o {opponent}.',
    'Falta perigosa cobrada para fora.', 'O técnico do {opponent} pede calma para o time.',
    'Chute de fora da área passa perto do gol.', 'Boa troca de passes no meio-campo.',
    'Torcida do {team} faz a festa nas arquibancadas.', 'Substituição no {opponent}.',
    'Cartão amarelo para um jogador do {opponent}.', 'VAR checa um possível pênalti... lance confirmado, segue o jogo.',
  ];

  function resolveDecision(beat, optionKey, player, ctx) {
    const def = DECISIONS[beat.key];
    const opt = def.options.find(o => o.key === optionKey) || def.options[0];
    const attrs = derived(player.attributes);
    const chance = clamp01(opt.chance(attrs));
    const success = Math.random() < chance;
    const result = { text: `${player.name} ${success ? opt.succ : opt.fail}`, mood: success ? 2.2 : -0.8, outcome: 'neutral', success };
    if (success) {
      if (opt.outcome === 'assist') { ctx.stats.assists = (ctx.stats.assists || 0) + 1; result.mood = 2; result.outcome = 'assist'; }
      else if (opt.outcome === 'goal') { ctx.stats.goals = (ctx.stats.goals || 0) + 1; result.mood = 3; result.outcome = 'goal'; }
      else if (opt.outcome === 'save') { result.mood = beat.key === 'penalti_contra' || beat.key === 'cara_a_cara_defesa' ? 3 : 1; result.outcome = 'save'; }
    } else {
      if (opt.cardRisk && Math.random() < opt.cardRisk) {
        ctx.stats.yellow = (ctx.stats.yellow || 0) + 1;
        result.text += ' O árbitro mostrou cartão amarelo.';
        result.mood -= 1;
      }
      // A failed defensive save or penalty stop concedes; a failed shot just wastes the chance.
      if (opt.outcome === 'save') { result.mood = -2; result.outcome = 'concede'; }
      else if (beat.key === 'penalti') result.mood = -2.5;
    }
    return result;
  }

  function resolveAuto(beat, player, ctx) {
    return beat.resolve(ctx);
  }

  // =========================================================================
  // MATCH TIMELINE — the public entry point. Builds a full 90-minute
  // sequence: ambient goals for both sides (from a reputation-driven
  // baseline), the player's own decision/auto beats woven in at their own
  // minutes, and flavor-only ticker lines to keep it feeling alive.
  // =========================================================================
  function buildMatchTimeline(player, teamLike, opponentLike, isHome) {
    const baseline = League.simulateCpuMatch(teamLike, opponentLike);
    const teammateGoalCount = isHome ? baseline.homeGoals : baseline.awayGoals;
    const opponentGoalCount = isHome ? baseline.awayGoals : baseline.homeGoals;

    const timeline = [];
    const usedMinutes = new Set();
    function pickMinute(lo, hi) {
      let m; let tries = 0;
      do { m = lo + Math.floor(Math.random() * (hi - lo)); tries++; } while (usedMinutes.has(m) && tries < 12);
      usedMinutes.add(m);
      return m;
    }

    // Ambient goals for our side (not from the player)
    for (let i = 0; i < teammateGoalCount; i++) {
      const scorer = DB.pick(TEAMMATE_FIRST) + ' ' + DB.pick(TEAMMATE_LAST);
      timeline.push({ minute: pickMinute(1, 89), kind: 'ambient_goal_for', text: `⚽ GOOOL do ${teamLike.name}! ${scorer} balança as redes!` });
    }
    // Ambient goals against
    for (let i = 0; i < opponentGoalCount; i++) {
      const scorer = DB.pick(TEAMMATE_FIRST) + ' ' + DB.pick(TEAMMATE_LAST);
      timeline.push({ minute: pickMinute(1, 89), kind: 'ambient_goal_against', text: `⚽ Gol do ${opponentLike.name}. ${scorer} define para o fundo do gol.`, cancellable: true });
    }

    // Player's own involvements
    const pool = POOLS[player.position] || POOLS.MC;
    const attrs = derived(player.attributes);
    const weighted = pool.map(e => ({ e, w: Math.max(0.15, e.weightFn(attrs)) }));
    const totalW = weighted.reduce((s, x) => s + x.w, 0);
    const roll = Math.random();
    const numBeats = roll < 0.12 ? 1 : roll < 0.55 ? 2 : roll < 0.85 ? 3 : roll < 0.97 ? 4 : 5;
    const usedKeys = new Set();
    for (let i = 0; i < numBeats; i++) {
      let r = Math.random() * totalW, chosen = weighted[0].e, tries = 0;
      for (const x of weighted) { if (r < x.w) { chosen = x.e; break; } r -= x.w; }
      if (usedKeys.has(chosen.key) && pool.length > 2 && tries < 4) { tries++; i--; continue; }
      usedKeys.add(chosen.key);
      const minute = pickMinute(3, 87);
      timeline.push(buildBeat(chosen, minute));
    }

    // Flavor-only ticker lines
    const flavorCount = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < flavorCount; i++) {
      const line = DB.pick(FLAVOR_LINES).replace('{team}', teamLike.name).replace('{opponent}', opponentLike.name);
      timeline.push({ minute: pickMinute(1, 89), kind: 'flavor', text: line });
    }

    timeline.push({ minute: 0, kind: 'kickoff', text: 'Apita o árbitro, começa o jogo!' });
    timeline.push({ minute: 45, kind: 'halftime', text: '🟨 Intervalo.' });
    timeline.push({ minute: 90, kind: 'fulltime', text: '🏁 Fim de jogo!' });

    timeline.sort((a, b) => a.minute - b.minute || (a.kind === 'kickoff' ? -1 : 0));
    return timeline;
  }

  function buildBeat(entry, minute) {
    if (entry.type === 'decision') {
      const def = DECISIONS[entry.key];
      return { minute, kind: 'decision', key: entry.key, prompt: def.prompt, options: def.options.map(o => ({ key: o.key, label: o.label })) };
    }
    return { minute, kind: 'auto', key: entry.key, resolve: entry.resolve };
  }

  const TEAMMATE_FIRST = ['Léo', 'Gustavo', 'Diego', 'Bruno', 'Caio', 'Miguel', 'Vitor', 'André', 'Renan', 'Otávio'];
  const TEAMMATE_LAST = ['Martins', 'Souza', 'Duarte', 'Ramos', 'Vieira', 'Correia', 'Antunes', 'Rocha', 'Cardoso', 'Farias'];

  return { buildMatchTimeline, resolveAuto, resolveDecision };
})();
