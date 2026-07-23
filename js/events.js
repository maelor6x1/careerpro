/**
 * events.js
 * ---------------------------------------------------------------------------
 * Builds the sequence of match "beats" the career player is involved in.
 * Some beats are automatic (a flavor moment resolves itself); others are
 * DECISIONS — the player picks an approach (e.g. "chute forte" vs "cavada")
 * and the outcome is rolled against that choice's success chance, which is
 * shaped by the player's attributes. career.js/ui.js drive the step-by-step
 * flow; this module only knows how to build the plan and resolve one step.
 * ---------------------------------------------------------------------------
 */

const Events = (() => {

  function clamp01(v) { return Math.max(0.03, Math.min(0.95, v)); }
  function derived(attrs) { return Object.assign({}, attrs, { cruzamento_eff: (attrs.controle + attrs.velocidade) * 0.04 }); }

  // =========================================================================
  // DECISION DEFINITIONS — keyed by event key. Each option has its own
  // success-chance formula and success/fail text.
  // =========================================================================
  const DECISIONS = {
    cara_a_cara: {
      prompt: 'Cara a cara com o goleiro! Como você finaliza?',
      options: [
        { key: 'forte', label: '💥 Chute forte', chance: a => 0.40 + (a.finalizacao - 60) * 0.006, succ: 'bateu forte e estufou a rede!', fail: 'chutou forte, mas para fora.' },
        { key: 'cavada', label: '🪁 Cavada por cima', chance: a => 0.32 + (a.drible - 60) * 0.006, succ: 'cavou a bola com categoria, sem chances para o goleiro!', fail: 'tentou a cavadinha, mas mandou por cima do travessão.' },
        { key: 'rasteiro', label: '🎯 Chute rasteiro no canto', chance: a => 0.45 + (a.controle - 60) * 0.005, succ: 'bateu rasteiro no cantinho, sem chances!', fail: 'chutou rasteiro, mas o goleiro defendeu.' },
      ],
    },
    chance_clara: {
      prompt: 'Grande chance na área! Qual a decisão?',
      options: [
        { key: 'primeira', label: '⚡ Finalizar de primeira', chance: a => 0.34 + (a.finalizacao - 60) * 0.006, succ: 'finalizou de primeira, gol!', fail: 'finalizou de primeira, mas a bola foi por cima.' },
        { key: 'ajeitar', label: '🎯 Ajeitar e bater', chance: a => 0.42 + (a.controle - 60) * 0.005, succ: 'ajeitou e bateu no cantinho, gol!', fail: 'ajeitou para finalizar, mas a zaga cortou.' },
        { key: 'cruzar', label: '🅰️ Cruzar para o companheiro', chance: a => 0.50 + (a.passe - 60) * 0.006, succ: 'cruzou e o companheiro só empurrou para o gol!', fail: 'cruzou, mas a defesa afastou o perigo.', assist: true },
      ],
    },
    penalti: {
      prompt: 'Pênalti! Para onde você bate?',
      options: [
        { key: 'esquerda', label: '⬅️ Canto esquerdo', chance: a => 0.72 + (a.finalizacao - 60) * 0.004, succ: 'cobrou no canto esquerdo, gol!', fail: 'bateu no canto esquerdo, o goleiro pegou!' },
        { key: 'direita', label: '➡️ Canto direito', chance: a => 0.72 + (a.finalizacao - 60) * 0.004, succ: 'cobrou no canto direito, gol!', fail: 'bateu no canto direito, o goleiro pegou!' },
        { key: 'meio', label: '⬆️ Meio do gol (cavadinha)', chance: a => 0.60 + (a.controle - 60) * 0.005, succ: 'cavou no meio do gol, o goleiro caiu para o lado, gol!', fail: 'tentou a cavadinha no meio, o goleiro ficou no meio e defendeu!' },
      ],
    },
    ultimo_passe: {
      prompt: 'Espaço para o passe final! Qual a escolha?',
      options: [
        { key: 'curto', label: '🎯 Passe seguro no pé', chance: a => 0.55 + (a.passe - 60) * 0.006, succ: 'tocou preciso e o companheiro só empurrou para o gol!', fail: 'o passe saiu forte demais e a zaga cortou.', assist: true },
        { key: 'lancamento', label: '🚀 Lançamento por cima', chance: a => 0.38 + (a.visao - 60) * 0.006, succ: 'lançou com precisão cirúrgica, assistência para o gol!', fail: 'o lançamento saiu longo demais e a defesa afastou.', assist: true },
        { key: 'cruzamento', label: '↗️ Cruzamento na área', chance: a => 0.40 + (a.cruzamento_eff - 4) * 0.05, succ: 'cruzou na medida e o companheiro cabeceou para o gol!', fail: 'cruzou, mas a zaga cortou antes do companheiro.', assist: true },
      ],
    },
    bola_dividida: {
      prompt: 'Bola dividida na entrada da área! Como você ataca a jogada?',
      options: [
        { key: 'carrinho', label: '🦵 Carrinho', chance: a => 0.48 + (a.marcacao - 60) * 0.006, succ: 'chegou no carrinho e tirou a bola com categoria!', fail: 'chegou atrasado no carrinho e cometeu falta perigosa.', cardRisk: 0.45 },
        { key: 'corpo', label: '💪 Disputa de corpo', chance: a => 0.5 + (a.fisico - 60) * 0.006, succ: 'venceu a disputa de corpo e afastou o perigo!', fail: 'perdeu a disputa física e o adversário ficou com a bola.' },
        { key: 'recuo', label: '🧤 Recuar e proteger o gol', chance: a => 0.75 + (a.posicionamento - 60) * 0.004, succ: 'jogou com segurança e neutralizou o contra-ataque.', fail: 'recuou, mas ainda assim foi superado na jogada.' },
      ],
    },
    penalti_contra: {
      prompt: 'Pênalti contra o seu time! Para onde você se joga?',
      options: [
        { key: 'esquerda', label: '⬅️ Pular para a esquerda', chance: a => 0.30 + (a.reflexo - 60) * 0.007, succ: 'DEFENDEU! Adivinhou o canto e fez a defesa!', fail: 'pulou para a esquerda, mas a bola foi para o outro canto.' },
        { key: 'direita', label: '➡️ Pular para a direita', chance: a => 0.30 + (a.reflexo - 60) * 0.007, succ: 'DEFENDEU! Adivinhou o canto e fez a defesa!', fail: 'pulou para a direita, mas a bola foi para o outro canto.' },
        { key: 'meio', label: '⬆️ Ficar no meio do gol', chance: a => 0.22 + (a.posicionamento - 60) * 0.006, succ: 'ficou parado no meio e defendeu o pênalti!', fail: 'ficou no meio, mas o batedor bateu no canto e marcou.' },
      ],
    },
    cara_a_cara_defesa: {
      prompt: 'Atacante adversário sai cara a cara com você! Qual a reação?',
      options: [
        { key: 'sair', label: '⚡ Sair no pé do atacante', chance: a => 0.42 + (a.reflexo - 60) * 0.006, succ: 'saiu no momento certo e tirou a bola do atacante!', fail: 'saiu do gol, mas o atacante driblou e marcou.' },
        { key: 'linha', label: '🧱 Ficar na linha, reduzir ângulo', chance: a => 0.48 + (a.posicionamento - 60) * 0.006, succ: 'fechou bem o ângulo e defendeu o chute!', fail: 'reduziu o ângulo, mas o chute passou por baixo.' },
        { key: 'blefe', label: '🎭 Blefar a saída', chance: a => 0.36 + (a.reflexo + a.posicionamento - 120) * 0.004, succ: 'confundiu o atacante, que finalizou para fora!', fail: 'o blefe não funcionou e o atacante bateu cruzado, gol.' },
      ],
    },
  };

  // =========================================================================
  // AUTOMATIC (non-decision) FLAVOR EVENTS — quick to resolve, no prompt.
  // =========================================================================
  function autoOutcome(text, mood, extra) { return () => Object.assign({ text, mood }, extra); }

  function cardAuto(ctx) {
    const red = Math.random() < 0.1;
    if (red) { ctx.stats.red = (ctx.stats.red || 0) + 1; return { text: '🟥 CARTÃO VERMELHO! Expulsão!', mood: -3 }; }
    ctx.stats.yellow = (ctx.stats.yellow || 0) + 1;
    return { text: '🟨 Cartão amarelo.', mood: -1 };
  }

  function injuryAuto(ctx) {
    const types = [
      { name: 'Contusão muscular', weeks: [1, 2] }, { name: 'Entorse no tornozelo', weeks: [2, 4] },
      { name: 'Lesão no joelho', weeks: [4, 10] }, { name: 'Fadiga muscular', weeks: [1, 1] },
    ];
    const t = types[Math.floor(Math.random() * types.length)];
    const weeks = t.weeks[0] + Math.floor(Math.random() * (t.weeks[1] - t.weeks[0] + 1));
    ctx.injury = { type: t.name, weeksLeft: weeks };
    return { text: `🚑 Sentiu uma lesão: ${t.name} (${weeks} semana(s) fora).`, mood: -2 };
  }

  function ownGoalAuto(ctx) { ctx.stats.concededOwnGoal = true; return { text: '😖 Gol contra! A bola desviou e entrou.', mood: -2.5 }; }
  function keeperErrorAuto() { return { text: '😬 Falhou na saída e o adversário aproveitou.', mood: -2.5 }; }
  function keeperSaveAuto() { return { text: '🧤 Fez uma defesa espetacular!', mood: 2 }; }

  // =========================================================================
  // POSITION POOLS — mix of decision beats and automatic flavor beats.
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
  // PUBLIC: plan + resolve
  // =========================================================================
  function planMatch(player) {
    const pool = POOLS[player.position] || POOLS.MC;
    const attrs = derived(player.attributes);
    const weighted = pool.map(e => ({ e, w: Math.max(0.15, e.weightFn(attrs)) }));
    const totalW = weighted.reduce((s, x) => s + x.w, 0);
    // Some matches are quiet for this player, others busier — weighted so
    // 2-3 is most common but 1 (anonymous game) and 4-5 (starring role) happen too.
    const roll = Math.random();
    const numBeats = roll < 0.12 ? 1 : roll < 0.55 ? 2 : roll < 0.85 ? 3 : roll < 0.97 ? 4 : 5;
    const beats = [];
    const usedKeys = new Set();
    for (let i = 0; i < numBeats; i++) {
      let r = Math.random() * totalW, chosen = weighted[0].e, tries = 0;
      for (const x of weighted) { if (r < x.w) { chosen = x.e; break; } r -= x.w; }
      // light de-dupe so the same decision doesn't repeat back-to-back
      if (usedKeys.has(chosen.key) && pool.length > 2 && tries < 4) { tries++; i--; continue; }
      usedKeys.add(chosen.key);
      beats.push(buildBeat(chosen, attrs));
    }
    return beats;
  }

  function buildBeat(entry, attrs) {
    if (entry.type === 'decision') {
      const def = DECISIONS[entry.key];
      return { id: uid(), key: entry.key, type: 'decision', prompt: def.prompt, options: def.options.map(o => ({ key: o.key, label: o.label })) };
    }
    return { id: uid(), key: entry.key, type: 'auto', resolve: entry.resolve };
  }

  function uid() { return Math.random().toString(36).slice(2, 9); }

  // Resolves an 'auto' beat immediately (career.js calls this as it steps through).
  function resolveAuto(beat, player, ctx) {
    return beat.resolve(ctx);
  }

  // Resolves a 'decision' beat given the option the user picked.
  function resolveDecision(beat, optionKey, player, ctx) {
    const def = DECISIONS[beat.key];
    const opt = def.options.find(o => o.key === optionKey) || def.options[0];
    const attrs = derived(player.attributes);
    const chance = clamp01(opt.chance(attrs));
    const success = Math.random() < chance;
    const result = { text: `${player.name} ${success ? opt.succ : opt.fail}`, mood: success ? 2.2 : -0.8 };
    if (success) {
      if (opt.assist) { ctx.stats.assists = (ctx.stats.assists || 0) + 1; result.mood = 2; }
      else if (['cara_a_cara', 'chance_clara', 'penalti', 'penalti_contra', 'cara_a_cara_defesa', 'bola_dividida'].includes(beat.key) && !opt.assist) {
        if (beat.key === 'penalti_contra' || beat.key === 'cara_a_cara_defesa') { result.mood = 3; }
        else if (beat.key === 'bola_dividida') { result.mood = 1; }
        else { ctx.stats.goals = (ctx.stats.goals || 0) + 1; result.mood = 3; }
      }
    } else {
      if (opt.cardRisk && Math.random() < opt.cardRisk) {
        ctx.stats.yellow = (ctx.stats.yellow || 0) + 1;
        result.text += ' O árbitro mostrou cartão amarelo.';
        result.mood -= 1;
      }
      if (beat.key === 'penalti_contra' || beat.key === 'penalti') result.mood = beat.key === 'penalti' ? -2.5 : -2;
    }
    return result;
  }

  return { planMatch, resolveAuto, resolveDecision };
})();
