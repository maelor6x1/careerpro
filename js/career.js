/**
 * career.js
 * ---------------------------------------------------------------------------
 * Owns the full career game-state machine: season/calendar progression,
 * matchday simulation (delegating per-player events to events.js), training,
 * coach squad-selection decisions, morale/press/crowd reactions, injury
 * recovery, national call-ups, and localStorage save/load.
 * ---------------------------------------------------------------------------
 */

const Career = (() => {

  const SAVE_KEY = 'careerpro_save_v1';
  let state = null;

  // -----------------------------------------------------------------------
  // NEW CAREER
  // -----------------------------------------------------------------------
  function startNewCareer(form) {
    const player = PlayerModel.createCareerPlayer(form);
    state = {
      player,
      season: 1,
      seasonYear: new Date().getFullYear(),
      week: 1,
      totalWeeksPerSeason: 38,
      calendar: [], // built once club is chosen
      calendarIndex: 0,
      club: null,
      league: null,
      squad: [],
      standings: {},
      news: [],
      inbox: [], // pending decisions: transfer offers, sponsor offers, interviews
      trophiesThisCareer: 0,
      trophyLog: [],
      economy: { balance: 0, sponsorDeals: [] },
      trainingPlan: null,
      matchLog: [],
      status: 'creating_player', // creating_player -> choosing_club -> in_career
    };
    save();
    return state;
  }

  function chooseClub(club) {
    state.club = club;
    state.league = club.league;
    state.squad = PlayerModel.generateSquad(club);
    state.player.contract = Transfers.makeContract(club, state.player, { years: 3, wageMultiplier: 0.5 });
    state.economy.balance = 0;
    buildSeasonCalendar();
    pushNews(`${state.player.name} assina com o ${club.name}!`, `O jovem ${DB.POSITION_NAMES[state.player.position].toLowerCase()} inicia sua carreira profissional.`);
    state.status = 'in_career';
    save();
  }

  function chooseLeagueThenClubs(leagueCode) {
    const clubs = DB.clubsByLeague(leagueCode).slice(0, 6);
    return Transfers.shuffleExport ? clubs : shuffleArr(clubs).slice(0, 3);
  }
  function shuffleArr(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[b[i], b[j]] = [b[j], b[i]]; } return b; }

  // -----------------------------------------------------------------------
  // CALENDAR — builds the season fixture list: estadual (if Brazilian club),
  // league rounds, cup rounds. Kept abstract (opponent names) since the
  // career player's own club results are what matters for the narrative.
  // -----------------------------------------------------------------------
  function buildSeasonCalendar() {
    const comps = DB.COMPETITIONS[state.league] || [state.league];
    const fixtures = [];
    if (state.league === 'BRA' && state.club.state) {
      const estadualName = DB.ESTADUAIS[state.club.state] || 'Estadual';
      for (let i = 1; i <= 10; i++) fixtures.push(fixture(estadualName, i));
    }
    const leagueName = DB.LEAGUES[state.league].name;
    for (let i = 1; i <= 24; i++) fixtures.push(fixture(leagueName, i));
    const cupName = comps[comps.length > 2 ? 1 : 0];
    for (let i = 1; i <= 5; i++) fixtures.push(fixture(cupName, i, true));
    state.calendar = fixtures;
    state.calendarIndex = 0;
  }

  function fixture(competition, round, isCup) {
    const opponent = DB.CLUBS[Math.floor(Math.random() * DB.CLUBS.length)];
    return { competition, round, opponent: opponent.name, opponentRep: opponent.reputation, isCup: !!isCup, played: false };
  }

  // -----------------------------------------------------------------------
  // COACH DECISION — starter / bench / reserve / loan-out / left out
  // -----------------------------------------------------------------------
  function coachDecision() {
    const p = state.player;
    // Only meaningfully stronger rivals in the same position count against you,
    // and the penalty is capped so one loaded position group can't lock a
    // young player out of the squad picture for their whole first seasons.
    const rivals = state.squad.filter(s => s.position === p.position && s.overall > p.overall + 3).length;
    const depthPenalty = Math.min(16, rivals * 4);
    const score = p.overall * 0.45 + p.form * 0.25 + p.morale * 0.15 + p.fitness * 0.15 - depthPenalty;
    if (p.injury) return 'lesionado';
    if (score > 62) return 'titular';
    if (score > 44) return 'banco';
    if (score > 28) return 'relacionado';
    return 'reserva';
  }

  // -----------------------------------------------------------------------
  // PLAY NEXT MATCH — the core turn of the game
  // -----------------------------------------------------------------------
  function playNextFixture() {
    if (state.calendarIndex >= state.calendar.length) return { seasonOver: true };
    const fx = state.calendar[state.calendarIndex];
    const p = state.player;
    const role = coachDecision();
    const result = { fixture: fx, role, played: false };

    if (role === 'titular' || role === 'banco' || role === 'relacionado') {
      const chance = role === 'titular' ? 1 : role === 'banco' ? 0.4 : 0.12;
      const playing = Math.random() < chance;
      if (playing && !p.injury) {
        const sim = Events.simulateMatchForPlayer(p);
        result.played = true;
        result.sim = sim;
        applyMatchResult(sim);
        maybeMOTM(sim);
      }
    }
    fx.played = true;
    state.calendarIndex += 1;

    tickInjury();
    tickMoraleAndFitness(result);
    maybeInterview(result);
    maybeCrowdReaction();
    maybePressStory(result);
    checkTrophy(fx);

    const offer = Transfers.maybeGenerateTransferOffer(state);
    if (offer) state.inbox.push({ type: 'transfer_offer', data: offer, id: uid() });

    if (state.week % 6 === 0) {
      const sponsor = Transfers.generateSponsorOffers(p);
      sponsor.forEach(s => state.inbox.push({ type: 'sponsor_offer', data: s, id: uid() }));
    }

    const callUp = Transfers.checkCallUp(p, state);
    if (callUp) state.inbox.push({ type: 'call_up', data: callUp, id: uid() });

    state.week += 1;
    save();
    return result;
  }

  function applyMatchResult(sim) {
    const p = state.player;
    const s = p.seasonStats;
    s.matches += 1; s.goals += sim.stats.goals; s.assists += sim.stats.assists;
    s.yellow += sim.stats.yellow; s.red += sim.stats.red;
    s.ratingSum += sim.rating; s.avgRating = Math.round((s.ratingSum / s.matches) * 100) / 100;
    p.form = PlayerModel.clamp(p.form + (sim.rating - 6.5) * 4, 20, 99);
    p.fitness = PlayerModel.clamp(p.fitness - 18, 10, 100);
    const xp = Math.round(20 + sim.stats.goals * 25 + sim.stats.assists * 15 + (sim.rating - 6) * 10);
    const gains = PlayerModel.grantXP(p, Math.max(5, xp));
    if (sim.injury) { p.injury = sim.injury; }
    p.popularity = PlayerModel.clamp(p.popularity + sim.stats.goals * 2 + sim.stats.assists * 1.2 + (sim.rating > 7.5 ? 1.5 : 0), 0, 100);
    state.matchLog.unshift({ text: sim.log.join(' '), rating: sim.rating, week: state.week });
    if (state.matchLog.length > 40) state.matchLog.length = 40;
  }

  function maybeMOTM(sim) {
    if (sim.rating >= 8.5 && Math.random() < 0.6) {
      state.player.seasonStats.motm += 1;
      pushNews('Craque do Jogo!', `${state.player.name} foi eleito o melhor em campo com nota ${sim.rating}.`);
    }
  }

  function tickInjury() {
    const p = state.player;
    if (p.injury) {
      p.injury.weeksLeft -= 1;
      if (p.injury.weeksLeft <= 0) { pushNews('De volta aos gramados', `${p.name} está recuperado e liberado para jogar.`); p.injury = null; }
    }
  }

  function tickMoraleAndFitness(result) {
    const p = state.player;
    p.fitness = PlayerModel.clamp(p.fitness + 10, 10, 100);
    if (!result.played) p.morale = PlayerModel.clamp(p.morale - 1, 25, 100);
    else p.morale = PlayerModel.clamp(p.morale + (result.sim && result.sim.rating > 7 ? 3 : 0.5), 0, 100);
  }

  function maybeInterview(result) {
    if (result.played && result.sim && (result.sim.rating >= 8 || result.fixture.round % 8 === 0)) {
      state.inbox.push({ type: 'interview', id: uid(), data: { context: result.fixture.competition, goodForm: result.sim.rating >= 7.5 } });
    }
  }

  function answerInterview(item, choiceKey) {
    const p = state.player;
    const effects = {
      humilde: { popularity: 2, morale: 1, coach: 1, crowd: 2 },
      confiante: { popularity: 3, morale: 2, coach: -1, crowd: 1 },
      critico: { popularity: -1, morale: -1, coach: -2, crowd: -2 },
      motivacional: { popularity: 1, morale: 2, coach: 2, crowd: 3 },
    };
    const e = effects[choiceKey] || effects.humilde;
    p.popularity = PlayerModel.clamp(p.popularity + e.popularity, 0, 100);
    p.morale = PlayerModel.clamp(p.morale + e.morale, 0, 100);
    removeInbox(item.id);
    save();
    return e;
  }

  function maybeCrowdReaction() {
    const p = state.player;
    if (Math.random() > 0.25) return;
    let reaction;
    if (p.form > 80) reaction = 'ama';
    else if (p.form > 60) reaction = 'aprova';
    else if (p.form > 40) reaction = 'cobra';
    else reaction = 'pede_venda';
    const texts = {
      ama: `A torcida do ${state.club.name} está apaixonada por ${p.name}!`,
      aprova: `Os torcedores aprovam o desempenho de ${p.name}.`,
      cobra: `A torcida cobra mais entrega de ${p.name}.`,
      pede_venda: `Setores da torcida já pedem a saída de ${p.name}.`,
    };
    pushNews('Reação da torcida', texts[reaction]);
  }

  function maybePressStory(result) {
    if (!result.played) return;
    const p = state.player, sim = result.sim;
    if (!sim) return;
    if (sim.stats.goals >= 2) pushNews('Imprensa repercute', `"Jovem promessa marca ${sim.stats.goals} gols e chama atenção", diz a imprensa.`);
    else if (sim.rating >= 8) pushNews('Destaque na imprensa', `"${p.name} brilha em atuação de gala pelo ${state.club.name}."`);
    else if (state.player.overall > 78 && Math.random() < 0.2) pushNews('Olho grande', `Grandes clubes europeus monitoram ${p.name}, segundo a imprensa.`);
  }

  function checkTrophy(fx) {
    if (fx.isCup && fx.round === 5 && Math.random() < 0.3) {
      const title = `${fx.competition} — ${state.seasonYear}`;
      state.trophiesThisCareer += 1;
      state.trophyLog.push(title);
      state.player.trophies.push(title);
      pushNews('🏆 Campeão!', `${state.club.name} conquista o título de ${fx.competition} com participação de ${state.player.name}!`);
    }
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
    p.fitness = PlayerModel.clamp(p.fitness - 15, 5, 100);
    p.marketValue = PlayerModel.estimateMarketValue(p.overall, p.potential, p.age);
    save();
    return { ok: true, gained };
  }

  // -----------------------------------------------------------------------
  // TRANSFERS & SPONSORS — resolving inbox items
  // -----------------------------------------------------------------------
  function acceptTransfer(item) {
    const { club, contractOffer, fee } = item.data;
    state.economy.balance += Math.round(fee * 0.05); // agent/signing cut, cosmetic
    state.club = club; state.league = club.league;
    state.squad = PlayerModel.generateSquad(club);
    state.player.contract = contractOffer;
    buildSeasonCalendar();
    pushNews('Transferência confirmada!', `${state.player.name} é o novo reforço do ${club.name} por ${formatMoney(fee)}.`);
    removeInbox(item.id);
    save();
  }
  function rejectTransfer(item) { removeInbox(item.id); save(); }

  function acceptSponsor(item) {
    state.economy.sponsorDeals.push(item.data);
    pushNews('Novo patrocínio', `${state.player.name} fecha contrato com ${item.data.sponsor.name}.`);
    removeInbox(item.id);
    save();
  }
  function rejectSponsor(item) { removeInbox(item.id); save(); }

  function acceptCallUp(item) {
    const p = state.player;
    p.caps += 1;
    p.popularity = PlayerModel.clamp(p.popularity + 4, 0, 100);
    pushNews('Convocação!', `${p.name} é convocado pela Seleção para ${item.data.competition}.`);
    removeInbox(item.id);
    save();
  }
  function declineCallUp(item) { removeInbox(item.id); save(); }

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
    state.week = 1;
    buildSeasonCalendar();
    pushNews('Nova temporada', `Temporada ${state.season} do ${state.club.name} começa agora.`);
    save();
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
    startNewCareer, chooseClub, playNextFixture, train, endSeason,
    acceptTransfer, rejectTransfer, acceptSponsor, rejectSponsor,
    acceptCallUp, declineCallUp, answerInterview, coachDecision,
    save, load, hasSave, wipeSave, getState, formatMoney,
  };
})();
