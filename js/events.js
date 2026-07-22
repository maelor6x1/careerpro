/**
 * events.js
 * ---------------------------------------------------------------------------
 * Simulates what happens to the career player during a single match, using
 * position-specific event pools where each event's probability is scaled by
 * the player's relevant attributes. This is what replaces "playing" the
 * match — the user reads the story of the match through these events.
 * ---------------------------------------------------------------------------
 */

const Events = (() => {

  // Each event: { key, label, weight(attrs) -> number, outcome(ctx) -> {text, stats, mood} }
  const POOLS = {
    ATA: [
      ev('chance_clara', a => 8 + a.posicionamento * 0.15, chanceEvent(0.55)),
      ev('cara_a_cara', a => 4 + a.finalizacao * 0.08, chanceEvent(0.45)),
      ev('cabeceio', a => 5 + a.cabeceio * 0.1, chanceEvent(0.4)),
      ev('penalti', a => 1.5, penaltyEvent),
      ev('contra_ataque', a => 4 + a.velocidade * 0.08, chanceEvent(0.5)),
      ev('chute_de_fora', a => 3 + a.finalizacao * 0.06, chanceEvent(0.25)),
      ev('assistencia', a => 5 + a.passe * 0.1, assistEvent),
      ev('drible', a => 4 + a.drible * 0.08, neutralEvent('driblou dois marcadores em jogada de efeito')),
      ev('gol_perdido', a => 6 - a.finalizacao * 0.03, missEvent),
      ev('falta_sofrida', a => 3, neutralEvent('sofreu uma falta perigosa na entrada da área')),
      ev('lesao', a => 0.8, injuryEvent),
      ev('cartao', a => 1.5, cardEvent),
    ],
    MEIA: [
      ev('passe_decisivo', a => 6 + a.visao * 0.1, assistEvent),
      ev('drible', a => 5 + a.drible * 0.1, neutralEvent('desequilibrou a marcação com um drible curto')),
      ev('finalizacao', a => 4 + a.finalizacao * 0.08, chanceEvent(0.35)),
      ev('roubo_bola', a => 3 + a.marcacao * 0.06, neutralEvent('recuperou a posse no meio-campo')),
      ev('lancamento', a => 3 + a.passe * 0.06, neutralEvent('encontrou o companheiro com um lançamento preciso')),
      ev('falta', a => 2, neutralEvent('cobrou falta perigosa perto da área')),
      ev('cartao', a => 1.3, cardEvent),
      ev('lesao', a => 0.7, injuryEvent),
    ],
    MC: [
      ev('passe_decisivo', a => 5 + a.visao * 0.1, assistEvent),
      ev('roubo_bola', a => 6 + a.marcacao * 0.08, neutralEvent('cortou o contra-ataque adversário')),
      ev('chute', a => 3 + a.finalizacao * 0.05, chanceEvent(0.25)),
      ev('escanteio', a => 2, neutralEvent('cobrou escanteio com perigo')),
      ev('lancamento', a => 4 + a.passe * 0.08, neutralEvent('trocou de lado o jogo com um lançamento')),
      ev('cartao', a => 1.5, cardEvent),
      ev('lesao', a => 0.7, injuryEvent),
    ],
    VOL: [
      ev('roubo_bola', a => 7 + a.interceptacao * 0.1, neutralEvent('desarmou o adversário no meio-campo')),
      ev('passe_decisivo', a => 3 + a.passe * 0.06, assistEvent),
      ev('lancamento', a => 3 + a.passe * 0.05, neutralEvent('iniciou a jogada com um passe longo')),
      ev('cartao', a => 2.5, cardEvent),
      ev('lesao', a => 0.7, injuryEvent),
    ],
    LE: lateralPool(), LD: lateralPool(),
    ZAG: [
      ev('carrinho', a => 5 + a.marcacao * 0.08, neutralEvent('fez um carrinho perfeito para tirar o perigo')),
      ev('interceptacao', a => 6 + a.interceptacao * 0.1, neutralEvent('interceptou o passe adversário')),
      ev('corte', a => 5 + a.posicionamento * 0.08, neutralEvent('afastou o perigo de cabeça')),
      ev('disputa_aerea', a => 4 + a.cabeceio * 0.06, neutralEvent('venceu a disputa aérea na área')),
      ev('gol_contra', a => 0.6, ownGoalEvent),
      ev('penalti_cometido', a => 1, concededPenaltyEvent),
      ev('cartao', a => 3, cardEvent),
      ev('lesao', a => 0.7, injuryEvent),
    ],
    GOL: [
      ev('defesa_dificil', a => 8 + a.reflexo * 0.1, neutralEvent('fez uma defesa espetacular')),
      ev('penalti', a => 1.2, goalkeeperPenaltyEvent),
      ev('saida_de_gol', a => 4 + a.posicionamento * 0.06, neutralEvent('saiu bem do gol para cortar o cruzamento')),
      ev('reposicao', a => 2, neutralEvent('iniciou o contra-ataque com uma reposição precisa')),
      ev('erro', a => 2.5 - a.reflexo * 0.01, keeperErrorEvent),
      ev('defesa_milagrosa', a => 2 + a.reflexo * 0.05, neutralEvent('salvou o time com uma defesa milagrosa')),
      ev('lesao', a => 0.5, injuryEvent),
    ],
  };

  function lateralPool() {
    return [
      ev('cruzamento', a => 6 + a.cruzamento_eff(), neutralEvent('cruzou com perigo na área')),
      ev('interceptacao', a => 4 + a.interceptacao * 0.06, neutralEvent('interceptou o avanço adversário')),
      ev('desarme', a => 4 + a.marcacao * 0.06, neutralEvent('desarmou o atacante na linha de fundo')),
      ev('assistencia', a => 3 + a.passe * 0.05, assistEvent),
      ev('cartao', a => 2, cardEvent),
      ev('lesao', a => 0.7, injuryEvent),
    ];
  }

  function ev(key, weightFn, outcome) { return { key, weightFn, outcome }; }

  // effective cross rating helper attached to attrs at runtime (drible+velocidade proxy since
  // "cruzamento" isn't a base attribute in the 14-attr model — derive from controle+velocidade)
  function withDerived(attrs) {
    return Object.assign({}, attrs, { cruzamento_eff: () => (attrs.controle + attrs.velocidade) * 0.04 });
  }

  // -----------------------------------------------------------------------
  // Outcome generators
  // -----------------------------------------------------------------------
  function chanceEvent(baseChance) {
    return (ctx) => {
      const conv = clamp01(baseChance + (ctx.attrs.finalizacao - 60) * 0.006);
      const scored = Math.random() < conv;
      if (scored) {
        ctx.stats.goals += 1;
        return { text: `⚽ GOL! ${ctx.player.name} balançou as redes!`, mood: 3 };
      }
      return { text: `${ctx.player.name} teve uma chance mas não converteu.`, mood: -0.5 };
    };
  }

  function missEvent(ctx) {
    return { text: `${ctx.player.name} desperdiçou uma boa oportunidade.`, mood: -1 };
  }

  function assistEvent(ctx) {
    ctx.stats.assists += 1;
    return { text: `🅰️ ${ctx.player.name} deu um passe perfeito para o gol do companheiro!`, mood: 2 };
  }

  function neutralEvent(text) {
    return (ctx) => ({ text: `${ctx.player.name} ${text}.`, mood: 0.5 });
  }

  function penaltyEvent(ctx) {
    const conv = clamp01(0.72 + (ctx.attrs.finalizacao - 60) * 0.005);
    if (Math.random() < conv) {
      ctx.stats.goals += 1;
      return { text: `⚽ PÊNALTI CONVERTIDO! ${ctx.player.name} não tremeu na cobrança!`, mood: 3 };
    }
    return { text: `${ctx.player.name} desperdiçou um pênalti importante!`, mood: -2.5 };
  }

  function goalkeeperPenaltyEvent(ctx) {
    const save = clamp01(0.28 + (ctx.attrs.reflexo - 60) * 0.006);
    if (Math.random() < save) {
      return { text: `🧤 DEFESA! ${ctx.player.name} defendeu o pênalti!`, mood: 3 };
    }
    return { text: `${ctx.player.name} não alcançou a cobrança de pênalti.`, mood: -1 };
  }

  function keeperErrorEvent(ctx) {
    return { text: `😬 ${ctx.player.name} falhou na saída e o adversário aproveitou.`, mood: -2.5 };
  }

  function ownGoalEvent(ctx) {
    return { text: `😖 Gol contra! A bola desviou em ${ctx.player.name} e entrou.`, mood: -2.5 };
  }

  function concededPenaltyEvent(ctx) {
    ctx.stats.yellow += 1;
    return { text: `${ctx.player.name} cometeu pênalti e viu cartão amarelo.`, mood: -2 };
  }

  function cardEvent(ctx) {
    const red = Math.random() < 0.12;
    if (red) { ctx.stats.red += 1; return { text: `🟥 CARTÃO VERMELHO! ${ctx.player.name} foi expulso!`, mood: -3 }; }
    ctx.stats.yellow += 1;
    return { text: `🟨 ${ctx.player.name} recebeu cartão amarelo.`, mood: -1 };
  }

  function injuryEvent(ctx) {
    const types = [
      { name: 'Contusão muscular', weeks: [1, 2] }, { name: 'Entorse no tornozelo', weeks: [2, 4] },
      { name: 'Lesão no joelho', weeks: [4, 10] }, { name: 'Fadiga muscular', weeks: [1, 1] },
    ];
    const t = types[Math.floor(Math.random() * types.length)];
    const weeks = t.weeks[0] + Math.floor(Math.random() * (t.weeks[1] - t.weeks[0] + 1));
    ctx.injury = { type: t.name, weeksLeft: weeks };
    return { text: `🚑 ${ctx.player.name} sentiu uma lesão: ${t.name} (${weeks} semana(s) fora).`, mood: -2 };
  }

  function clamp01(v) { return Math.max(0.02, Math.min(0.95, v)); }

  // -----------------------------------------------------------------------
  // Public: simulate the career player's involvement in one match
  // -----------------------------------------------------------------------
  function simulateMatchForPlayer(player) {
    const pool = POOLS[player.position] || POOLS.MC;
    const attrs = withDerived(player.attributes);
    const stats = { goals: 0, assists: 0, yellow: 0, red: 0 };
    const log = [];
    const numEvents = 2 + Math.floor(Math.random() * 3); // 2-4 involvements
    let injury = null;
    let moodTotal = 0;

    // weighted pick loop
    const weighted = pool.map(e => ({ e, w: Math.max(0.1, e.weightFn(attrs)) }));
    const totalW = weighted.reduce((s, x) => s + x.w, 0);

    for (let i = 0; i < numEvents; i++) {
      if (stats.red > 0) break; // sent off, match over for the player
      let r = Math.random() * totalW, chosen = weighted[0].e;
      for (const x of weighted) { if (r < x.w) { chosen = x.e; break; } r -= x.w; }
      const ctx = { player, attrs, stats, injury: null };
      const result = chosen.outcome(ctx);
      if (ctx.injury) injury = ctx.injury;
      log.push(result.text);
      moodTotal += result.mood;
      if (injury) break;
    }

    // Match rating derived from involvement quality
    let rating = 6.0 + moodTotal * 0.35 + stats.goals * 0.6 + stats.assists * 0.35 - stats.yellow * 0.2 - stats.red * 1.5;
    rating = Math.max(3.5, Math.min(10, rating));

    return { log, stats, rating: Math.round(rating * 10) / 10, injury };
  }

  return { simulateMatchForPlayer, POOLS };
})();
