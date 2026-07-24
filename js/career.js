/**
 * career.js
 * ---------------------------------------------------------------------------
 * Owns the full career game-state machine. A "round" is the unit of
 * progression: every club in the competition plays its round-robin or
 * knockout fixture. CPU-vs-CPU games are resolved instantly (League.js);
 * the career player's own match is played out beat-by-beat through
 * Events.js, with the person choosing how to approach each key moment.
 * ---------------------------------------------------------------------------
 */

const Career = (() => {

  const SAVE_KEY = 'careerpro_save_v2';
  let state = null;

  // -----------------------------------------------------------------------
  // NEW CAREER
  // -----------------------------------------------------------------------
  function startNewCareer(form) {
    const player = PlayerModel.createCareerPlayer(form);
    player.trainingTokens = 3;
    state = {
      player,
      season: 1,
      year: 2026,
      week: 1,
      club: null,
      league: null,
      squad: [],
      competitions: null, // { phase, estadual, liga, copa }
      news: [],
      inbox: [],
      trophyLog: [],
      economy: { balance: 0, sponsorDeals: [] },
      matchLog: [],
      currentMatch: null, // active interactive match, if any
      _pendingRound: null, // internal: results already simulated for the round in progress
      status: 'creating_player',
    };
    save();
    return state;
  }

  function chooseClub(club) {
    state.club = club;
    state.league = club.league;
    state.squad = PlayerModel.generateSquad(club);
    state.player.contract = Transfers.makeContract(club, state.player, { years: 3, wageMultiplier: 0.5, startYear: state.year });
    state.economy.balance = 0;
    buildCompetitions();
    pushNews(`${state.player.name} assina com o ${club.name}!`, `O jovem ${DB.POSITION_NAMES[state.player.position].toLowerCase()} inicia sua carreira profissional.`);
    state.status = 'in_career';
    save();
  }

  // -----------------------------------------------------------------------
  // COMPETITIONS SETUP — every phase is scoped strictly to the club's own
  // league (and, for the estadual, its own state), so fixtures never mix
  // clubs from different leagues.
  // -----------------------------------------------------------------------
  function buildCompetitions() {
    const league = state.league;
    const leagueMeta = DB.LEAGUES[league];
    const cupName = DB.CUPS[league] || 'Copa Nacional';

    let estadual = null;
    if (league === 'BRA' && state.club.state) {
      const stateClubIds = DB.clubsByState('BRA', state.club.state).map(c => c.id);
      if (stateClubIds.length >= 3) {
        estadual = League.buildLeaguePhase(DB.ESTADUAIS[state.club.state] || 'Campeonato Estadual', stateClubIds, false);
      }
    }

    if (leagueMeta.format === 'zones') {
      // Argentina: player's own zone plays out round by round; the other
      // zone is simulated in bulk (see resolveOtherZone) once it's needed
      // for playoff seeding — the person never sees those games individually,
      // same as they wouldn't follow the other zone's fixtures in real life.
      const myZone = state.club.zone;
      const otherZone = myZone === 'A' ? 'B' : 'A';
      const zoneIds = DB.clubsByZone('ARG', myZone).map(c => c.id);
      const liga = League.buildLeaguePhase(`${leagueMeta.name} — Zona ${myZone}`, zoneIds, false);
      state.competitions = {
        phase: estadual ? 'estadual' : 'liga', estadual, liga, copa: null, continental: buildContinentalPhase(league),
        _argOtherZone: otherZone, _argCupName: cupName,
      };
      return;
    }

    const leagueClubIds = DB.clubsByLeague(league).map(c => c.id);
    const liga = League.buildLeaguePhase(leagueMeta.name, leagueClubIds, true);
    const cupSize = Math.min(16, leagueClubIds.length);
    const cupSeeds = leagueClubIds.slice().sort((a, b) => clubRep(b) - clubRep(a)).slice(0, cupSize);
    const copa = League.buildCupPhase(cupName, shuffleArr(cupSeeds));
    const continental = buildContinentalPhase(league);

    state.competitions = { phase: estadual ? 'estadual' : 'liga', estadual, liga, copa, continental };
  }

  // Eligibility is by reputation percentile within the confederation's
  // in-game clubs — top tier plays the Libertadores/Champions League,
  // next tier the Sul-Americana/Europa League, the rest sit it out this season.
  function buildContinentalPhase(league) {
    const confInfo = DB.continentalFor(league);
    if (!confInfo) return null;
    const poolIds = confInfo.leagues.reduce((acc, l) => acc.concat(DB.clubsByLeague(l).map(c => c.id)), []);
    const sorted = poolIds.slice().sort((a, b) => clubRep(b) - clubRep(a));
    const rank = sorted.indexOf(state.club.id);
    const pct = sorted.length ? rank / sorted.length : 1;
    let compName = null;
    if (pct < 0.25) compName = confInfo.top;
    else if (pct < 0.55) compName = confInfo.second;
    if (!compName) return null;
    let seeds = shuffleArr(sorted).slice(0, Math.min(16, sorted.length));
    if (!seeds.includes(state.club.id)) seeds[Math.floor(Math.random() * seeds.length)] = state.club.id;
    return League.buildCupPhase(compName, seeds);
  }

  // Argentina only: once the player's own zone finishes, simulate the other
  // zone's whole round-robin in bulk to get its final table, then seed the
  // playoff bracket with the top 8 from each zone (16 teams, like the real
  // format's knockout stage).
  function resolveArgentinaPlayoffSeeding() {
    const otherZone = state.competitions._argOtherZone;
    const otherIds = DB.clubsByZone('ARG', otherZone).map(c => c.id);
    const otherPhase = League.buildLeaguePhase('temp', otherIds, false);
    while (otherPhase.roundIndex < otherPhase.rounds.length) {
      const data = League.simulateLeagueRound(otherPhase, '__none__');
      League.finishLeagueRound(otherPhase);
    }
    const otherTop8 = League.sortedStandings(otherPhase.table, id => DB.CLUBS.find(c => c.id === id)).slice(0, 8).map(s => s.clubId);
    const myTop8 = League.sortedStandings(state.competitions.liga.table, id => DB.CLUBS.find(c => c.id === id)).slice(0, 8).map(s => s.clubId);
    const seeds = shuffleArr(myTop8.concat(otherTop8));
    state.competitions.copa = League.buildCupPhase(state.competitions._argCupName, seeds);
  }

  function clubRep(id) { const c = DB.CLUBS.find(x => x.id === id); return c ? c.reputation : 50; }
  function shuffleArr(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[b[i], b[j]] = [b[j], b[i]]; } return b; }
  function currentPhaseObj() { return state.competitions[state.competitions.phase]; }

  // -----------------------------------------------------------------------
  // COACH DECISION
  // -----------------------------------------------------------------------
  function coachDecision() {
    const p = state.player;
    const rivals = state.squad.filter(s => s.position === p.position && s.overall > p.overall + 3).length;
    const depthPenalty = Math.min(16, rivals * 4);
    const tirednessPenalty = p.fitness < 35 ? (35 - p.fitness) * 0.8 : 0;
    const score = p.overall * 0.45 + p.form * 0.25 + p.morale * 0.15 + p.fitness * 0.15 - depthPenalty - tirednessPenalty;
    if (p.injury) return 'lesionado';
    if (score > 62) return 'titular';
    if (score > 44) return 'banco';
    if (score > 28) return 'relacionado';
    return 'reserva';
  }

  // -----------------------------------------------------------------------
  // ROUND PREP — simulates every other match in the round right away and
  // hands back whether the player's own club has a match to play.
  // -----------------------------------------------------------------------
  function prepareRound() {
    const phaseKey = state.competitions.phase;
    if (phaseKey === 'offseason') return { seasonOver: true };
    const phase = currentPhaseObj();
    if (!phase) return advancePhase();

    const isCup = phase.type === 'copa';
    const roundData = isCup ? League.simulateCupRound(phase, state.club.id) : League.simulateLeagueRound(phase, state.club.id);
    if (roundData.done) return advancePhase();

    const role = coachDecision();
    const byeThisRound = !roundData.playerFixture;
    const willPlay = !byeThisRound && (role === 'titular' || role === 'banco' || role === 'relacionado')
      && Math.random() < (role === 'titular' ? 1 : role === 'banco' ? 0.45 : 0.15) && !state.player.injury;

    state._pendingRound = { phaseKey, isCup, roundData, role, byeThisRound };

    if (byeThisRound) {
      return { needsMatch: false, bye: true, phaseKey, competition: phase.name, roundNumber: roundData.roundNumber, totalRounds: roundData.totalRounds, role };
    }

    const opponentId = roundData.playerFixture.home === state.club.id ? roundData.playerFixture.away : roundData.playerFixture.home;
    const opponent = opponentId ? DB.CLUBS.find(c => c.id === opponentId) : null;
    const isHome = roundData.playerFixture.home === state.club.id;

    if (!opponent) { // cup bye slot paired with "no one" — shouldn't normally happen but stay safe
      return { needsMatch: false, bye: true, phaseKey, competition: phase.name, roundNumber: roundData.roundNumber, totalRounds: roundData.totalRounds, role };
    }

    return {
      needsMatch: willPlay, phaseKey, competition: phase.name, opponent, isHome, role,
      roundNumber: roundData.roundNumber, totalRounds: roundData.totalRounds,
      otherResults: isCup ? roundData.resolved : roundData.otherResults,
    };
  }

  function advancePhase() {
    const order = ['estadual', 'liga', 'copa', 'continental', 'offseason'];
    let idx = order.indexOf(state.competitions.phase);
    // finalize champion news for the phase we're leaving, if applicable
    const leaving = state.competitions[order[idx]];
    if (leaving && leaving.champion) announceChampion(leaving);
    idx++;
    if (state.league === 'ARG' && order[idx] === 'copa' && !state.competitions.copa) {
      resolveArgentinaPlayoffSeeding();
    }
    while (idx < order.length - 1 && !state.competitions[order[idx]]) idx++;
    state.competitions.phase = order[idx];
    save();
    if (state.competitions.phase === 'offseason') return { seasonOver: true };
    return prepareRound();
  }

  function announceChampion(phase) {
    const championClub = DB.CLUBS.find(c => c.id === phase.champion);
    if (!championClub) return;
    const isPlayerClub = phase.champion === state.club.id;
    if (isPlayerClub) {
      state.trophyLog.push(`${phase.name} — Temporada ${state.season}`);
      state.player.trophies.push(`${phase.name} — Temporada ${state.season}`);
      pushNews('🏆 CAMPEÃO!', `${state.club.name} conquista o título de ${phase.name} com participação de ${state.player.name}!`);
    } else {
      pushNews('Fim de competição', `${championClub.name} é o campeão de ${phase.name}.`);
    }
  }

  // -----------------------------------------------------------------------
  // INTERACTIVE MATCH — begin / step / conclude. The live score lives on
  // state.currentMatch.score and is updated event-by-event as the timeline
  // plays out, so a goal or assist can never fail to reach the scoreboard.
  // -----------------------------------------------------------------------
  function beginPlayerMatch() {
    const pending = state._pendingRound;
    const opponentId = pending.roundData.playerFixture.home === state.club.id ? pending.roundData.playerFixture.away : pending.roundData.playerFixture.home;
    const opponent = DB.CLUBS.find(c => c.id === opponentId);
    const isHome = pending.roundData.playerFixture.home === state.club.id;
    const timeline = Events.buildMatchTimeline(state.player, state.club, opponent, isHome);
    state.currentMatch = {
      timeline, index: 0, score: { for: 0, against: 0 },
      ctx: { stats: { goals: 0, assists: 0, yellow: 0, red: 0 }, injury: null },
      log: [], lastMood: 0, opponentId, isHome, unavailable: false,
    };
    save();
    return nextEventPacket();
  }

  function nextEventPacket() {
    const m = state.currentMatch;
    if (!m) return { matchOver: true };
    if (m.index >= m.timeline.length) return { matchOver: true };
    return { matchOver: false, event: m.timeline[m.index], score: m.score };
  }

  // Called by the UI for every timeline entry. Pass optionKey only for
  // 'decision' entries — everything else (goals, flavor, kickoff/HT/FT)
  // resolves on its own.
  function stepMatch(optionKey) {
    const m = state.currentMatch;
    const ev = m.timeline[m.index];
    let result;

    if (ev.kind === 'decision') {
      if (m.unavailable) result = { text: `${state.player.name} já não está mais em campo para esta jogada.`, mood: 0, outcome: 'neutral' };
      else result = Events.resolveDecision(ev, optionKey, state.player, m.ctx);
      applyOutcomeToMatch(m, result);
    } else if (ev.kind === 'auto') {
      if (m.unavailable) result = { text: `${state.player.name} segue fora de campo.`, mood: 0, outcome: 'neutral' };
      else result = Events.resolveAuto(ev, state.player, m.ctx);
      applyOutcomeToMatch(m, result);
    } else if (ev.kind === 'ambient_goal_for') {
      m.score.for += 1; result = { text: ev.text, mood: 0.5, outcome: 'neutral' };
    } else if (ev.kind === 'ambient_goal_against') {
      m.score.against += 1; result = { text: ev.text, mood: -0.5, outcome: 'neutral' };
    } else {
      result = { text: ev.text, mood: 0, outcome: 'neutral' };
    }

    if (m.ctx.injury || m.ctx.stats.red > 0) m.unavailable = true;
    m.log.push(result.text);
    m.lastMood += result.mood || 0;
    m.index += 1;
    save();
    return { result, next: nextEventPacket() };
  }

  // A successful save/defense can cancel the next still-pending ambient
  // goal against — the game's way of showing that defending actually
  // prevents goals, not just decorates the commentary feed.
  function applyOutcomeToMatch(m, result) {
    if (result.outcome === 'goal' || result.outcome === 'assist') {
      m.score.for += 1;
    } else if (result.outcome === 'concede') {
      m.score.against += 1;
    } else if (result.outcome === 'save') {
      for (let i = m.index + 1; i < m.timeline.length; i++) {
        if (m.timeline[i].kind === 'ambient_goal_against') {
          m.timeline[i] = { minute: m.timeline[i].minute, kind: 'flavor', text: 'Grande defesa evita o gol adversário!' };
          break;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // CONCLUDE ROUND — folds the (possibly just-played) match into the table
  // or bracket, applies XP/morale/press, advances the round pointer.
  // -----------------------------------------------------------------------
  function concludeRound() {
    const pending = state._pendingRound;
    const phase = state.competitions[pending.phaseKey];
    let summary = { phaseKey: pending.phaseKey, competition: phase.name, played: false };

    if (state.currentMatch) {
      const m = state.currentMatch;
      const p = state.player;
      const opponent = DB.CLUBS.find(c => c.id === m.opponentId);
      const playerTeamGoals = m.score.for;
      const opponentTeamGoals = m.score.against;

      const homeId = m.isHome ? state.club.id : m.opponentId;
      const awayId = m.isHome ? m.opponentId : state.club.id;
      const homeGoals = m.isHome ? playerTeamGoals : opponentTeamGoals;
      const awayGoals = m.isHome ? opponentTeamGoals : playerTeamGoals;
      const playerGoals = m.ctx.stats.goals, playerAssists = m.ctx.stats.assists;

      applyMatchToPlayer(m, playerGoals, playerAssists);

      if (pending.isCup) {
        let winner;
        if (playerTeamGoals > opponentTeamGoals) winner = state.club.id;
        else if (playerTeamGoals < opponentTeamGoals) winner = m.opponentId;
        else winner = Math.random() < 0.55 ? state.club.id : m.opponentId; // decided on penalties
        const playerResult = { pair: pending.roundData.playerFixture, winner, homeGoals, awayGoals, penalties: homeGoals === awayGoals, home: DB.CLUBS.find(c => c.id === homeId).name, away: DB.CLUBS.find(c => c.id === awayId).name };
        const allResults = pending.roundData.resolved.concat([playerResult]);
        const finish = League.finishCupRound(phase, allResults);
        summary.eliminated = winner !== state.club.id;
        summary.advanced = winner === state.club.id;
        summary.phaseOver = finish.phaseOver;
        if (finish.phaseOver) phase.champion = finish.champion;
      } else {
        League.applyResult(phase.table, homeId, awayId, homeGoals, awayGoals);
        const finish = League.finishLeagueRound(phase);
        summary.phaseOver = finish.phaseOver;
      }

      summary.played = true;
      summary.homeTeam = DB.CLUBS.find(c => c.id === homeId).name;
      summary.awayTeam = DB.CLUBS.find(c => c.id === awayId).name;
      summary.homeGoals = homeGoals; summary.awayGoals = awayGoals;
      summary.playerGoals = playerGoals; summary.playerAssists = playerAssists;
      summary.rating = m.rating;
      summary.log = m.log;
      summary.otherResults = pending.roundData.otherResults || pending.roundData.resolved || [];

      state.matchLog.unshift({ text: `${summary.homeTeam} ${homeGoals}x${awayGoals} ${summary.awayTeam} — ${m.log.join(' ')}`, rating: m.rating, week: state.week });
      if (state.matchLog.length > 40) state.matchLog.length = 40;
      state.currentMatch = null;
    } else {
      // bye or benched: only fatigue/morale ticks, table already updated for others
      tickMoraleFitnessNoPlay();
      if (pending.isCup) {
        // if the player's club had a bye (auto-advance), fold that in too
        if (pending.byeThisRound) {
          const allResults = pending.roundData.resolved || [];
          const finish = League.finishCupRound(phase, allResults);
          summary.phaseOver = finish.phaseOver;
          if (finish.phaseOver) phase.champion = finish.champion;
        }
      } else {
        const finish = League.finishLeagueRound(phase);
        summary.phaseOver = finish.phaseOver;
      }
      summary.otherResults = pending.roundData.otherResults || pending.roundData.resolved || [];
    }

    tickInjuryRecovery();
    weeklyFitnessRecovery();
    maybeCrowdReaction();
    maybePressStory(summary);

    const offer = Transfers.maybeGenerateTransferOffer(state);
    if (offer) state.inbox.push({ type: 'transfer_offer', data: offer, id: uid() });
    if (state.week % 5 === 0) Transfers.generateSponsorOffers(state.player, state).forEach(s => state.inbox.push({ type: 'sponsor_offer', data: s, id: uid() }));
    const callUp = Transfers.checkCallUp(state.player, state);
    if (callUp) state.inbox.push({ type: 'call_up', data: callUp, id: uid() });
    if (summary.played && summary.rating >= 8.2 && Math.random() < 0.5) state.inbox.push({ type: 'interview', id: uid(), data: {} });

    state.week += 1;
    state.player.trainingTokens = 3; // fresh training sessions for the week ahead, EAFC-style
    state._pendingRound = null;

    if (summary.phaseOver) {
      const advanced = advancePhase();
      summary.seasonOver = advanced.seasonOver || false;
    }

    save();
    return summary;
  }

  function applyMatchToPlayer(m, goals, assists) {
    const p = state.player;
    const s = p.seasonStats;
    s.matches += 1; s.goals += goals; s.assists += assists;
    s.yellow += m.ctx.stats.yellow; s.red += m.ctx.stats.red;
    const rating = computeRating(m, goals, assists);
    m.rating = rating;
    s.ratingSum += rating; s.avgRating = Math.round((s.ratingSum / s.matches) * 100) / 100;
    p.form = PlayerModel.clamp(p.form + (rating - 6.5) * 4, 20, 99);
    p.fitness = PlayerModel.clamp(p.fitness - 12, 10, 100);
    p.morale = PlayerModel.clamp(p.morale + (rating > 7 ? 3 : 0.5), 0, 100);
    const xp = Math.round(20 + goals * 25 + assists * 15 + (rating - 6) * 10);
    PlayerModel.grantXP(p, Math.max(5, xp));
    if (m.ctx.injury) p.injury = m.ctx.injury;
    p.popularity = PlayerModel.clamp(p.popularity + goals * 2 + assists * 1.2 + (rating > 7.5 ? 1.5 : 0), 0, 100);
    if (rating >= 8.5 && Math.random() < 0.6) { s.motm += 1; pushNews('Craque do Jogo!', `${p.name} foi eleito o melhor em campo com nota ${rating}.`); }
  }

  function computeRating(m, goals, assists) {
    let rating = 6.0 + (m.lastMood || 0) * 0.3 + goals * 0.6 + assists * 0.35 - m.ctx.stats.yellow * 0.2 - m.ctx.stats.red * 1.5;
    return Math.round(Math.max(3.5, Math.min(10, rating)) * 10) / 10;
  }

  function tickMoraleFitnessNoPlay() {
    const p = state.player;
    p.morale = PlayerModel.clamp(p.morale - 1, 25, 100);
  }

  // Fatigue eases naturally week to week regardless of whether the athlete
  // played, the way real recovery/physio work between matches.
  function weeklyFitnessRecovery() {
    const p = state.player;
    p.fitness = PlayerModel.clamp(p.fitness + 16, 10, 100);
  }

  function tickInjuryRecovery() {
    const p = state.player;
    if (p.injury) {
      p.injury.weeksLeft -= 1;
      if (p.injury.weeksLeft <= 0) { pushNews('De volta aos gramados', `${p.name} está recuperado e liberado para jogar.`); p.injury = null; }
    }
  }

  function maybeCrowdReaction() {
    const p = state.player;
    if (Math.random() > 0.25) return;
    let key = p.form > 80 ? 'ama' : p.form > 60 ? 'aprova' : p.form > 40 ? 'cobra' : 'pede_venda';
    const texts = {
      ama: `A torcida do ${state.club.name} está apaixonada por ${p.name}!`,
      aprova: `Os torcedores aprovam o desempenho de ${p.name}.`,
      cobra: `A torcida cobra mais entrega de ${p.name}.`,
      pede_venda: `Setores da torcida já pedem a saída de ${p.name}.`,
    };
    pushNews('Reação da torcida', texts[key]);
  }

  function maybePressStory(summary) {
    if (!summary.played) return;
    const p = state.player;
    if (summary.playerGoals >= 2) pushNews('Imprensa repercute', `"Jovem promessa marca ${summary.playerGoals} gols e chama atenção", diz a imprensa.`);
    else if (summary.rating >= 8) pushNews('Destaque na imprensa', `"${p.name} brilha em atuação de gala pelo ${state.club.name}."`);
    else if (p.overall > 78 && Math.random() < 0.2) pushNews('Olho grande', `Grandes clubes monitoram ${p.name}, segundo a imprensa.`);
  }

  // -----------------------------------------------------------------------
  // TRAINING
  // -----------------------------------------------------------------------
  const TRAINING_PLANS = {
    finalizacao: ['finalizacao', 'posicionamento'], passe: ['passe', 'visao'],
    fisico: ['fisico', 'resistencia'], defesa: ['marcacao', 'interceptacao'],
    tecnica: ['drible', 'controle'], goleiro: ['reflexo', 'posicionamento'],
  };
  function train(planKey) {
    const p = state.player;
    if ((p.trainingTokens || 0) <= 0) return { ok: false, reason: 'Sem sessões de treino disponíveis nesta semana. Jogue a próxima rodada para liberar mais.' };
    if (p.fitness < 25) return { ok: false, reason: 'Fadiga muito alta. Deixe o atleta descansar.' };
    const attrs = TRAINING_PLANS[planKey] || TRAINING_PLANS.tecnica;
    const gained = {};
    attrs.forEach(a => {
      if (Math.random() < 0.6 && p.attributes[a] < p.potential) {
        p.attributes[a] = PlayerModel.clamp(p.attributes[a] + 1, 1, 99);
        gained[a] = (gained[a] || 0) + 1;
      }
    });
    p.overall = PlayerModel.computeOverall(p.attributes, p.position);
    p.fitness = PlayerModel.clamp(p.fitness - 10, 5, 100);
    p.marketValue = PlayerModel.estimateMarketValue(p.overall, p.potential, p.age);
    p.trainingTokens = Math.max(0, (p.trainingTokens || 0) - 1);
    save();
    return { ok: true, gained };
  }

  // -----------------------------------------------------------------------
  // TRANSFERS & SPONSORS — resolving inbox items
  // -----------------------------------------------------------------------
  function acceptTransfer(item) {
    const { club, contractOffer, fee } = item.data;
    state.economy.balance += Math.round(fee * 0.05);
    state.club = club; state.league = club.league;
    state.squad = PlayerModel.generateSquad(club);
    state.player.contract = contractOffer;
    buildCompetitions();
    pushNews('Transferência confirmada!', `${state.player.name} é o novo reforço do ${club.name} por ${formatMoney(fee)}.`);
    removeInbox(item.id);
    save();
  }
  function rejectTransfer(item) { removeInbox(item.id); save(); }

  function acceptSponsor(item) {
    state.player.sponsor = item.data;
    state.economy.sponsorDeals.push(item.data);
    pushNews('Novo patrocínio', `${state.player.name} fecha contrato com ${item.data.sponsor.name}.`);
    removeInbox(item.id);
    save();
  }
  function rejectSponsor(item) { removeInbox(item.id); save(); }

  function acceptCallUp(item) {
    pushNews('Convocação!', `${state.player.name} é convocado pela Seleção para ${item.data.competition}.`);
    removeInbox(item.id);
    save();
    return item.data; // { competition, nationality } — game.js uses this to start the match
  }
  function declineCallUp(item) { removeInbox(item.id); save(); }

  // -----------------------------------------------------------------------
  // NATIONAL TEAM MATCH — reuses the same timeline engine and step/resolve
  // functions as club matches (state.currentMatch), just with a different
  // begin/conclude pair since there's no domestic table or bracket involved.
  // -----------------------------------------------------------------------
  function beginNationalMatch(competition) {
    const p = state.player;
    const myTeam = DB.getNationalTeam(p.nationality);
    const pool = DB.allNationTeamNationalities().filter(n => n !== p.nationality);
    const oppNationality = pool[Math.floor(Math.random() * pool.length)];
    const oppTeam = DB.getNationalTeam(oppNationality);
    const isHome = Math.random() < 0.5;
    const timeline = Events.buildMatchTimeline(p, myTeam, oppTeam, isHome);
    state.currentMatch = {
      timeline, index: 0, score: { for: 0, against: 0 },
      ctx: { stats: { goals: 0, assists: 0, yellow: 0, red: 0 }, injury: null },
      log: [], lastMood: 0, isHome, unavailable: false,
      isNational: true, competition, myTeam, oppTeam,
    };
    save();
    return nextEventPacket();
  }

  function concludeNationalMatch() {
    const m = state.currentMatch;
    const p = state.player;
    const rating = computeRating(m, m.ctx.stats.goals, m.ctx.stats.assists);
    p.caps += 1;
    p.goalsNT = (p.goalsNT || 0) + m.ctx.stats.goals;
    p.popularity = PlayerModel.clamp(p.popularity + m.ctx.stats.goals * 1.5 + 2.5, 0, 100);
    p.form = PlayerModel.clamp(p.form + (rating - 6.5) * 2, 20, 99);
    const homeTeam = m.isHome ? m.myTeam.name : m.oppTeam.name;
    const awayTeam = m.isHome ? m.oppTeam.name : m.myTeam.name;
    const homeGoals = m.isHome ? m.score.for : m.score.against;
    const awayGoals = m.isHome ? m.score.against : m.score.for;
    const summary = {
      played: true, competition: m.competition, isNational: true,
      homeTeam, awayTeam, homeGoals, awayGoals,
      playerGoals: m.ctx.stats.goals, playerAssists: m.ctx.stats.assists, rating,
      log: m.log,
    };
    pushNews('Seleção', `${p.name} defende ${m.myTeam.shortName} em ${m.competition}: ${homeTeam} ${homeGoals}x${awayGoals} ${awayTeam}.`);
    state.currentMatch = null;
    save();
    return summary;
  }

  // -----------------------------------------------------------------------
  // AWARD RACES — Bola de Ouro / Chuteira de Ouro / Luva de Ouro. CPU
  // squads don't simulate individual stats match-by-match, so their season
  // lines are estimated from overall + position + how far the season has
  // progressed, seeded by player id so the leaderboard stays stable between
  // views instead of reshuffling on every render.
  // -----------------------------------------------------------------------
  function seededFrac(id) {
    let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const x = Math.sin(Math.abs(h)) * 10000;
    return x - Math.floor(x);
  }
  const GOAL_POS_WEIGHT = { ATA: 1, PE: 0.75, PD: 0.75, MEIA: 0.55, MC: 0.28, VOL: 0.14, LE: 0.14, LD: 0.14, ZAG: 0.07, GOL: 0.01 };
  const ASSIST_POS_WEIGHT = { ATA: 0.4, PE: 0.7, PD: 0.7, MEIA: 0.9, MC: 0.6, VOL: 0.3, LE: 0.45, LD: 0.45, ZAG: 0.08, GOL: 0.01 };

  function estimateGoals(pl, progress) {
    const w = GOAL_POS_WEIGHT[pl.position] || 0.2;
    const base = Math.max(0, (pl.overall - 48) / 50) * 26 * w;
    return Math.round(base * (0.75 + seededFrac(pl.id) * 0.5) * progress);
  }
  function estimateAssists(pl, progress) {
    const w = ASSIST_POS_WEIGHT[pl.position] || 0.2;
    const base = Math.max(0, (pl.overall - 48) / 50) * 18 * w;
    return Math.round(base * (0.75 + seededFrac(pl.id + 'a') * 0.5) * progress);
  }
  function estimateConceded(pl, progress) {
    const matches = Math.round(30 * progress);
    const concededPerMatch = Math.max(0.3, (100 - pl.overall) / 55);
    return { matches, conceded: Math.round(concededPerMatch * matches) };
  }

  function getAwardRaces() {
    const league = state.league;
    const progress = Math.max(0.05, Math.min(1, state.week / 40));
    const candidateClubs = DB.clubsByLeague(league).slice().sort((a, b) => b.reputation - a.reputation).slice(0, 6);
    const pool = []; // { pl, club }
    candidateClubs.forEach(c => {
      const squad = c.id === state.club.id ? state.squad : PlayerModel.generateSquad(c);
      squad.filter(pl => pl.isStarter || pl.overall >= c.reputation - 3).slice(0, 3).forEach(pl => pool.push({ pl, club: c }));
    });

    const p = state.player;

    const scorers = pool.map(({ pl, club }) => ({ name: pl.name, club, goals: estimateGoals(pl, progress) }));
    scorers.push({ name: p.name, club: state.club, goals: p.seasonStats.goals, isCareer: true });
    scorers.sort((a, b) => b.goals - a.goals);

    const ballonDor = pool.map(({ pl, club }) => ({
      name: pl.name, club, score: estimateGoals(pl, progress) * 2 + estimateAssists(pl, progress) * 1.5 + pl.overall * 0.3,
    }));
    ballonDor.push({ name: p.name, club: state.club, score: p.seasonStats.goals * 2 + p.seasonStats.assists * 1.5 + p.overall * 0.3 + (state.trophyLog.length * 5), isCareer: true });
    ballonDor.sort((a, b) => b.score - a.score);

    const keepers = pool.filter(({ pl }) => pl.position === 'GOL').map(({ pl, club }) => {
      const est = estimateConceded(pl, progress);
      return { name: pl.name, club, conceded: est.conceded, matches: est.matches };
    });
    if (p.position === 'GOL') keepers.push({ name: p.name, club: state.club, conceded: Math.round((p.seasonStats.matches || 0) * 1.1), matches: p.seasonStats.matches, isCareer: true });
    keepers.sort((a, b) => a.conceded - b.conceded);

    return {
      chuteiraDeOuro: scorers.slice(0, 8),
      bolaDeOuro: ballonDor.slice(0, 8),
      luvaDeOuro: p.position === 'GOL' ? keepers.slice(0, 8) : null,
    };
  }

  function answerInterview(item, choiceKey) {
    const p = state.player;
    const effects = {
      humilde: { popularity: 2, morale: 1 }, confiante: { popularity: 3, morale: 2 },
      critico: { popularity: -1, morale: -1 }, motivacional: { popularity: 1, morale: 2 },
    };
    const e = effects[choiceKey] || effects.humilde;
    p.popularity = PlayerModel.clamp(p.popularity + e.popularity, 0, 100);
    p.morale = PlayerModel.clamp(p.morale + e.morale, 0, 100);
    removeInbox(item.id);
    save();
    return e;
  }

  function removeInbox(id) { state.inbox = state.inbox.filter(i => i.id !== id); }

  // -----------------------------------------------------------------------
  // SEASON ROLLOVER
  // -----------------------------------------------------------------------
  function endSeason() {
    const p = state.player;
    p.history.push({ season: state.season, club: state.club.name, ...p.seasonStats, overall: p.overall });
    p.seasonStats = PlayerModel.freshSeasonStats();
    p.age += 1;
    state.season += 1;
    state.year += 1;
    state.week = 1;
    buildCompetitions();
    pushNews('Nova temporada', `Temporada ${state.season} do ${state.club.name} começa agora.`);
    save();
  }

  // -----------------------------------------------------------------------
  // STANDINGS / BRACKET ACCESSORS FOR UI
  // -----------------------------------------------------------------------
  function getStandings(phaseKey) {
    const phase = state.competitions[phaseKey];
    if (!phase || phase.type !== 'liga') return [];
    return League.sortedStandings(phase.table, id => DB.CLUBS.find(c => c.id === id));
  }
  function getBracket(phaseKey) {
    const phase = state.competitions[phaseKey || 'copa'];
    if (!phase || phase.type !== 'copa') return null;
    return phase;
  }

  // -----------------------------------------------------------------------
  // UTIL
  // -----------------------------------------------------------------------
  function pushNews(title, body) {
    state.news.unshift({ title, body, week: state.week, season: state.season });
    if (state.news.length > 60) state.news.length = 60;
  }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function formatMoney(v) {
    if (v >= 1000000) return `€${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `€${(v / 1000).toFixed(0)}K`;
    return `€${v}`;
  }

  // -----------------------------------------------------------------------
  // SAVE / LOAD
  // -----------------------------------------------------------------------
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { console.warn('Falha ao salvar', e); } }
  function load() { try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { state = JSON.parse(raw); return true; } } catch (e) { console.warn('Falha ao carregar', e); } return false; }
  function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
  function wipeSave() { localStorage.removeItem(SAVE_KEY); state = null; }
  function getState() { return state; }

  return {
    startNewCareer, chooseClub, coachDecision, prepareRound, beginPlayerMatch, stepMatch, concludeRound, peekEvent: nextEventPacket,
    beginNationalMatch, concludeNationalMatch,
    train, endSeason, acceptTransfer, rejectTransfer, acceptSponsor, rejectSponsor,
    acceptCallUp, declineCallUp, answerInterview, getStandings, getBracket, getAwardRaces,
    save, load, hasSave, wipeSave, getState, formatMoney,
  };
})();
