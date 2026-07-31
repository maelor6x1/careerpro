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

  const SAVE_KEY = 'careerpro_save_v3';
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
      nationalTournament: null,
      majorTournamentsThisYear: [],
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
        estadual, liga, copa: null, continental: buildContinentalPhase(league),
        cadenceIndex: 0, _argOtherZone: otherZone, _argCupName: cupName,
      };
      return;
    }

    const leagueClubIds = DB.clubsByLeague(league).map(c => c.id);
    const liga = League.buildLeaguePhase(leagueMeta.name, leagueClubIds, true);
    const cupSize = Math.min(16, leagueClubIds.length);
    const cupSeeds = leagueClubIds.slice().sort((a, b) => clubRep(b) - clubRep(a)).slice(0, cupSize);
    const copa = League.buildCupPhase(cupName, shuffleArr(cupSeeds));
    const continental = buildContinentalPhase(league);

    state.competitions = { estadual, liga, copa, continental, cadenceIndex: 0 };
  }

  // Eligibility: real league position from the previous season decides who
  // gets in (top spots -> Champions/Libertadores, next tier -> Europa/Sul-
  // Americana), exactly like real football. The domestic cup winner also
  // earns a berth if they didn't already qualify by table position. Only
  // works once state.qualification has data (from a season actually played
  // in this save) — the very first season falls back to a reputation
  // estimate since there's no prior table to read yet.
  function buildContinentalPhase(league) {
    const confInfo = DB.continentalFor(league);
    if (!confInfo) return null;
    const isConmebol = confInfo === DB.CONTINENTAL.CONMEBOL;
    const fieldSize = isConmebol ? 32 : 36;

    const poolIds = confInfo.leagues.reduce((acc, l) => acc.concat(DB.clubsByLeague(l).map(c => c.id)), []);
    const ranked = poolIds.slice().sort((a, b) => clubRep(b) - clubRep(a));
    const myRank = ranked.indexOf(state.club.id);

    let tier = null, entrants = null;
    if (myRank >= 0 && myRank < fieldSize) { tier = 'top'; entrants = ranked.slice(0, fieldSize); }
    else if (myRank >= fieldSize && myRank < fieldSize * 2) { tier = 'second'; entrants = ranked.slice(fieldSize, fieldSize * 2); }
    else {
      // Not close enough by reputation alone — fall back to the season's
      // real qualification result if we have one (own league only).
      tier = qualificationTierFor(state.club.id, league);
      if (!tier) return null;
      const filtered = ranked.filter(id => qualificationTierFor(id, leagueOf(id)) === tier);
      entrants = filtered.length >= fieldSize ? filtered.slice(0, fieldSize) : filtered;
      if (!entrants.includes(state.club.id)) entrants = entrants.slice(0, fieldSize - 1).concat([state.club.id]);
    }

    const compName = tier === 'top' ? confInfo.top : confInfo.second;
    const seeds = shuffleArr(entrants);

    if (isConmebol) {
      // Libertadores/Sul-Americana: real format — 32 clubs, 8 groups of 4.
      return League.buildGroupStagePhase(compName, seeds, 4);
    }
    // Champions/Europa League: real format since 2024 — 36-club league phase.
    return League.buildSwissPhase(compName, seeds, Math.min(8, seeds.length - 1));
  }

  function leagueOf(clubId) { const c = DB.CLUBS.find(x => x.id === clubId); return c ? c.league : null; }

  // Returns 'top' | 'second' | null for a club in a given league, based on
  // last season's real final standing (state.qualification), falling back
  // to a reputation-percentile guess for leagues/seasons with no history yet.
  function qualificationTierFor(clubId, league) {
    if (state.qualification && state.qualification[league] && state.qualification[league][clubId]) {
      return state.qualification[league][clubId];
    }
    const poolIds = DB.clubsByLeague(league).map(c => c.id);
    const sorted = poolIds.slice().sort((a, b) => clubRep(b) - clubRep(a));
    const rank = sorted.indexOf(clubId);
    const pct = sorted.length ? rank / sorted.length : 1;
    if (pct < 0.2) return 'top';
    if (pct < 0.45) return 'second';
    return null;
  }

  // Computes next season's qualification for the player's own league from
  // this season's real final table + cup winner, and stores it so next
  // season's buildContinentalPhase() uses real results instead of a guess.
  function updateQualificationFromSeason() {
    const league = state.league;
    const leagueMeta = DB.LEAGUES[league];
    if (!DB.continentalFor(league)) return;
    if (!state.qualification) state.qualification = {};
    const table = {};
    if (leagueMeta.format === 'zones') {
      // Argentina: combine both zones' final tables if available.
      const liga = state.competitions.liga;
      if (!liga || !liga.champion) return;
      const standings = League.sortedStandings(liga.table, id => DB.CLUBS.find(c => c.id === id));
      const topCut = Math.max(1, Math.round(standings.length * 0.3));
      const secondCut = Math.max(topCut + 1, Math.round(standings.length * 0.6));
      standings.forEach((s, i) => { table[s.clubId] = i < topCut ? 'top' : i < secondCut ? 'second' : null; });
    } else {
      const liga = state.competitions.liga;
      if (!liga || !liga.champion) return;
      const standings = League.sortedStandings(liga.table, id => DB.CLUBS.find(c => c.id === id));
      const topCut = 4, secondCut = 6;
      standings.forEach((s, i) => { table[s.clubId] = i < topCut ? 'top' : i < secondCut ? 'second' : null; });
    }
    // Domestic cup winner gets a guaranteed berth if not already qualified.
    if (state.competitions.copa && state.competitions.copa.champion) {
      const cupWinner = state.competitions.copa.champion;
      if (!table[cupWinner]) table[cupWinner] = 'second';
    }
    state.qualification[league] = table;
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

  // Real-life fixtures don't wait for one competition to fully finish before
  // another starts — league, cup and continental games interleave across
  // the calendar. This cadence pattern reproduces that: mostly league
  // rounds, with a cup or continental fixture worked in periodically.
  const CADENCE = ['liga', 'liga', 'liga', 'copa', 'liga', 'liga', 'liga', 'continental'];

  // Unwraps a top-level competition key into whatever sub-stage is
  // currently playable: the phase itself for a straightforward league/cup,
  // or — for group-stage/Swiss continental competitions — either the
  // group/league stage or (once that's done) its knockout bracket.
  function resolvePlayable(topKey) {
    const top = state.competitions[topKey];
    if (!top || top.champion) return null;
    if (top.type === 'liga' || top.type === 'copa') return { obj: top, kind: top.type, top, topKey };
    if (top.type === 'grupos') {
      if (top.knockout) {
        if (top.knockout.champion) { top.champion = top.knockout.champion; return null; }
        return { obj: top.knockout, kind: 'copa', top, topKey };
      }
      return { obj: top, kind: top.isSwiss ? 'swiss' : 'groupstage', top, topKey };
    }
    return null;
  }

  function nextPhaseKey() {
    if (typeof state.competitions.cadenceIndex !== 'number' || isNaN(state.competitions.cadenceIndex)) {
      state.competitions.cadenceIndex = 0;
    }
    // The estadual is a genuine sequential block in real life — it happens
    // and finishes before the national league season even starts.
    if (state.competitions.estadual && !state.competitions.estadual.champion) return 'estadual';
    // Argentina: once this club's zone (liga) wraps up, seed the combined
    // playoff bracket from both zones before anything else can proceed.
    if (state.league === 'ARG' && state.competitions.liga && state.competitions.liga.champion && !state.competitions.copa) {
      resolveArgentinaPlayoffSeeding();
    }
    for (let tries = 0; tries < CADENCE.length * 3; tries++) {
      const key = CADENCE[state.competitions.cadenceIndex % CADENCE.length];
      state.competitions.cadenceIndex = (state.competitions.cadenceIndex + 1) % CADENCE.length;
      if (resolvePlayable(key)) return key;
    }
    return null; // nothing left to play this season
  }

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
  // ROUND PREP — picks the next playable fixture via the interleaved
  // cadence, simulates every other match in that round right away, and
  // hands back whether the player's own club has a match to play.
  // -----------------------------------------------------------------------
  function prepareRound() {
    if (state.nationalTournament && !state.nationalTournament.finished) {
      return { nationalTournamentActive: true, competition: state.nationalTournament.competition };
    }
    const topKey = nextPhaseKey();
    if (!topKey) return { seasonOver: true };
    const resolved = resolvePlayable(topKey);
    if (!resolved) return prepareRound(); // competition just finished between calls — try again
    const { obj: phase, kind } = resolved;

    let roundData;
    if (kind === 'liga') roundData = League.simulateLeagueRound(phase, state.club.id);
    else if (kind === 'copa') roundData = League.simulateCupRound(phase, state.club.id);
    else if (kind === 'groupstage') roundData = League.simulateGroupStageRound(phase, state.club.id);
    else if (kind === 'swiss') roundData = League.simulateSwissRound(phase, state.club.id);

    if (roundData.done) return prepareRound(); // this sub-stage just wrapped up — pick again

    const role = coachDecision();
    const byeThisRound = !roundData.playerFixture;
    const willPlay = !byeThisRound && (role === 'titular' || role === 'banco' || role === 'relacionado')
      && Math.random() < (role === 'titular' ? 1 : role === 'banco' ? 0.45 : 0.15) && !state.player.injury;

    state._pendingRound = { topKey, kind, phase, top: resolved.top, isCup: kind === 'copa', roundData, role, byeThisRound };

    if (byeThisRound) {
      return { needsMatch: false, bye: true, topKey, competition: phase.name, roundNumber: roundData.roundNumber, totalRounds: roundData.totalRounds, role };
    }

    const opponentId = roundData.playerFixture.home === state.club.id ? roundData.playerFixture.away : roundData.playerFixture.home;
    const opponent = opponentId ? DB.CLUBS.find(c => c.id === opponentId) : null;
    const isHome = roundData.playerFixture.home === state.club.id;

    if (!opponent) { // cup bye slot paired with "no one" — advance automatically
      state._pendingRound.byeThisRound = true;
      return { needsMatch: false, bye: true, topKey, competition: phase.name, roundNumber: roundData.roundNumber, totalRounds: roundData.totalRounds, role };
    }

    return {
      needsMatch: willPlay, topKey, competition: phase.name, opponent, isHome, role, isKnockout: kind === 'copa',
      roundNumber: roundData.roundNumber, totalRounds: roundData.totalRounds,
      otherResults: kind === 'copa' ? roundData.resolved : roundData.otherResults,
    };
  }

  // For group-stage/Swiss continental competitions, the champion only ever
  // gets set on the nested knockout bracket — this lifts it up to the
  // top-level competition object and announces it exactly once.
  function resolveTopChampion(pending) {
    const top = pending.top;
    if (top.type === 'grupos' && !top.champion && top.knockout && top.knockout.champion) top.champion = top.knockout.champion;
    if (top.champion && !top._announced) { top._announced = true; announceChampion(top); }
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
    const phase = pending.phase;
    let summary = { topKey: pending.topKey, competition: phase.name, played: false };

    if (state.currentMatch) {
      const m = state.currentMatch;
      const opponent = DB.CLUBS.find(c => c.id === m.opponentId);
      let playerTeamGoals = m.score.for;
      let opponentTeamGoals = m.score.against;
      let extraTime = false, penalties = false;

      if (pending.isCup && playerTeamGoals === opponentTeamGoals) {
        extraTime = true;
        playerTeamGoals += League.poissonish(0.35); opponentTeamGoals += League.poissonish(0.35);
      }
      if (pending.isCup && playerTeamGoals === opponentTeamGoals) {
        penalties = true;
        const gkBonus = state.player.position === 'GOL' ? (state.player.attributes.reflexo - 60) * 0.003 : 0;
        const weWin = Math.random() < (0.5 + gkBonus);
        let us = 3 + Math.floor(Math.random() * 3), them = 3 + Math.floor(Math.random() * 3);
        if (weWin && us <= them) us = them + 1; if (!weWin && them <= us) them = us + 1;
        summary.penaltyScore = { us, them, weWin };
        if (weWin) playerTeamGoals += 1; else opponentTeamGoals += 1; // nominal +1 just to break the tie for the scoreline
      }

      const homeId = m.isHome ? state.club.id : m.opponentId;
      const awayId = m.isHome ? m.opponentId : state.club.id;
      const homeGoals = m.isHome ? playerTeamGoals : opponentTeamGoals;
      const awayGoals = m.isHome ? opponentTeamGoals : playerTeamGoals;
      const playerGoals = m.ctx.stats.goals, playerAssists = m.ctx.stats.assists;

      applyMatchToPlayer(m, playerGoals, playerAssists);

      if (pending.isCup) {
        const winner = playerTeamGoals > opponentTeamGoals ? state.club.id : m.opponentId;
        const playerResult = { pair: pending.roundData.playerFixture, winner, homeGoals, awayGoals, penalties, extraTime, home: DB.CLUBS.find(c => c.id === homeId).name, away: DB.CLUBS.find(c => c.id === awayId).name };
        const allResults = pending.roundData.resolved.concat([playerResult]);
        const finish = League.finishCupRound(phase, allResults);
        summary.eliminated = winner !== state.club.id;
        summary.advanced = winner === state.club.id;
        summary.wentToPenalties = penalties; summary.wentToExtraTime = extraTime;
        if (finish.phaseOver) phase.champion = finish.champion;
      } else if (pending.kind === 'liga') {
        League.applyResult(phase.table, homeId, awayId, homeGoals, awayGoals);
        League.finishLeagueRound(phase);
      } else if (pending.kind === 'groupstage') {
        League.applyResult(pending.roundData.playerGroup.table, homeId, awayId, homeGoals, awayGoals);
        League.finishGroupStageRound(phase);
      } else if (pending.kind === 'swiss') {
        League.applyResult(phase.table, homeId, awayId, homeGoals, awayGoals);
        League.finishSwissRound(phase);
      }
      resolveTopChampion(pending);
      summary.phaseOver = !!pending.top.champion;

      summary.played = true;
      summary.homeTeam = DB.CLUBS.find(c => c.id === homeId).name;
      summary.awayTeam = DB.CLUBS.find(c => c.id === awayId).name;
      summary.homeGoals = homeGoals; summary.awayGoals = awayGoals;
      summary.playerGoals = playerGoals; summary.playerAssists = playerAssists;
      summary.rating = m.rating;
      summary.log = m.log;
      summary.otherResults = pending.roundData.otherResults || pending.roundData.resolved || [];

      const scoreLabel = penalties ? `${summary.homeGoals}x${summary.awayGoals} (pênaltis)` : extraTime ? `${summary.homeGoals}x${summary.awayGoals} (prorrogação)` : `${summary.homeGoals}x${summary.awayGoals}`;
      state.matchLog.unshift({ text: `${summary.homeTeam} ${scoreLabel} ${summary.awayTeam}`, rating: m.rating, week: state.week, competition: summary.competition });
      if (state.matchLog.length > 40) state.matchLog.length = 40;
      state.currentMatch = null;
    } else {
      // Player didn't feature this round — but unless it's a genuine bye
      // week, the club still plays the fixture. Simulate it like any other
      // match in the round so the table/bracket always reflects a result.
      tickMoraleFitnessNoPlay();

      if (!pending.byeThisRound && pending.roundData.playerFixture) {
        const fixture = pending.roundData.playerFixture;
        const homeClub = DB.CLUBS.find(c => c.id === fixture.home);
        const awayClub = DB.CLUBS.find(c => c.id === fixture.away);
        let homeGoals, awayGoals, result = null;
        if (pending.isCup) {
          result = League.resolveCupPair(fixture);
          homeGoals = result.homeGoals; awayGoals = result.awayGoals;
        } else {
          const sim = League.simulateCpuMatch(homeClub, awayClub);
          homeGoals = sim.homeGoals; awayGoals = sim.awayGoals;
        }
        summary.played = false;
        summary.clubPlayedWithoutYou = true;
        summary.homeTeam = homeClub.name; summary.awayTeam = awayClub.name;
        summary.homeGoals = homeGoals; summary.awayGoals = awayGoals;

        if (pending.isCup) {
          const allResults = pending.roundData.resolved.concat([result]);
          const finish = League.finishCupRound(phase, allResults);
          summary.eliminated = result.winner !== state.club.id;
          summary.advanced = result.winner === state.club.id;
          summary.wentToPenalties = result.penalties; summary.wentToExtraTime = result.extraTime;
          if (result.penalties) summary.penaltyScore = { us: result.winner === state.club.id ? Math.max(result.penaltyHome, result.penaltyAway) : Math.min(result.penaltyHome, result.penaltyAway), them: result.winner === state.club.id ? Math.min(result.penaltyHome, result.penaltyAway) : Math.max(result.penaltyHome, result.penaltyAway), weWin: result.winner === state.club.id };
          if (finish.phaseOver) phase.champion = finish.champion;
        } else if (pending.kind === 'liga') {
          League.applyResult(phase.table, fixture.home, fixture.away, homeGoals, awayGoals);
          League.finishLeagueRound(phase);
        } else if (pending.kind === 'groupstage') {
          League.applyResult(pending.roundData.playerGroup.table, fixture.home, fixture.away, homeGoals, awayGoals);
          League.finishGroupStageRound(phase);
        } else if (pending.kind === 'swiss') {
          League.applyResult(phase.table, fixture.home, fixture.away, homeGoals, awayGoals);
          League.finishSwissRound(phase);
        }
        resolveTopChampion(pending);
        summary.phaseOver = !!pending.top.champion;
        const scoreLabel = result && result.penalties ? `${homeGoals}x${awayGoals} (pênaltis)` : result && result.extraTime ? `${homeGoals}x${awayGoals} (prorrogação)` : `${homeGoals}x${awayGoals}`;
        state.matchLog.unshift({ text: `${homeClub.name} ${scoreLabel} ${awayClub.name} (você não foi relacionado)`, rating: null, week: state.week });
        if (state.matchLog.length > 40) state.matchLog.length = 40;
      } else if (pending.isCup && pending.byeThisRound) {
        const allResults = pending.roundData.resolved || [];
        const finish = League.finishCupRound(phase, allResults);
        if (finish.phaseOver) phase.champion = finish.champion;
        resolveTopChampion(pending);
        summary.phaseOver = !!pending.top.champion;
      } else if (pending.kind === 'liga') {
        League.finishLeagueRound(phase);
        resolveTopChampion(pending);
        summary.phaseOver = !!pending.top.champion;
      } else if (pending.kind === 'groupstage') {
        League.finishGroupStageRound(phase);
        resolveTopChampion(pending);
        summary.phaseOver = !!pending.top.champion;
      } else if (pending.kind === 'swiss') {
        League.finishSwissRound(phase);
        resolveTopChampion(pending);
        summary.phaseOver = !!pending.top.champion;
      }
      summary.otherResults = pending.roundData.otherResults || pending.roundData.resolved || [];
    }

    tickInjuryRecovery();
    weeklyFitnessRecovery();
    maybeCrowdReaction();
    maybePressStory(summary);

    // Transfer interest is now resolved through the end-of-contract
    // renewal/transfer screen (see endSeason) instead of random mid-season
    // popups, so a player under contract is never approached out of nowhere.
    if (state.week % 5 === 0) Transfers.generateSponsorOffers(state.player, state).forEach(s => state.inbox.push({ type: 'sponsor_offer', data: s, id: uid() }));
    const callUp = Transfers.checkCallUp(state.player, state);
    if (callUp) {
      state.inbox.push({ type: 'call_up', data: callUp, id: uid() });
      if (MAJOR_TOURNAMENTS.includes(callUp.competition)) {
        state.majorTournamentsThisYear = state.majorTournamentsThisYear || [];
        state.majorTournamentsThisYear.push(callUp.competition);
      }
    }
    if (summary.played && summary.rating >= 8.2 && Math.random() < 0.5) state.inbox.push({ type: 'interview', id: uid(), data: { template: pickInterviewTemplate() } });

    state.week += 1;
    state.player.trainingTokens = 3; // fresh training sessions for the week ahead, EAFC-style
    state._pendingRound = null;

    summary.seasonOver = isSeasonOver();

    save();
    return summary;
  }

  function isSeasonOver() {
    const c = state.competitions;
    if (c.estadual && !c.estadual.champion) return false;
    if (c.liga && !c.liga.champion) return false;
    if (c.copa && !c.copa.champion) return false;
    if (c.continental && !c.continental.champion) return false;
    return true;
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
    finalizacao: ['finalizacao', 'posicionamento', 'cabeceio'], passe: ['passe', 'visao', 'controle'],
    fisico: ['fisico', 'resistencia', 'velocidade'], defesa: ['marcacao', 'interceptacao', 'posicionamento'],
    tecnica: ['drible', 'controle', 'velocidade'], goleiro: ['reflexo', 'posicionamento', 'defesa'],
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
  const MAJOR_TOURNAMENTS = ['Copa do Mundo', 'Copa América', 'Eurocopa', 'Copa Ouro', 'Copa Africana de Nações', 'Copa da Ásia'];

  function opponentPoolFor(competition, nationality) {
    const myConf = DB.confederationOf(nationality);
    if (competition === 'Copa do Mundo') return DB.allNationTeamNationalities().filter(n => n !== nationality);
    return DB.allNationTeamNationalities().filter(n => n !== nationality && DB.confederationOf(n) === myConf);
  }

  // -----------------------------------------------------------------------
  // NATIONAL TOURNAMENT — for the big competitions (World Cup, continental
  // championships) the domestic season genuinely pauses while it's on, and
  // the player plays a real mini-tournament: a 4-team group stage followed
  // by a semifinal and final. Qualifiers/Nations League/friendlies stay as
  // a single one-off match and never pause the club calendar.
  // -----------------------------------------------------------------------
  function beginNationalMatch(competition) {
    if (MAJOR_TOURNAMENTS.includes(competition)) {
      startNationalTournament(competition);
      return prepareNationalTournamentRound();
    }
    const p = state.player;
    const myTeam = DB.getNationalTeam(p.nationality);
    const pool = opponentPoolFor(competition, p.nationality);
    const oppNationality = pool[Math.floor(Math.random() * pool.length)] || DB.allNationTeamNationalities().find(n => n !== p.nationality);
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

  function startNationalTournament(competition) {
    const p = state.player;
    const pool = opponentPoolFor(competition, p.nationality);
    const groupOpponents = shuffleArr(pool).slice(0, Math.min(3, pool.length));
    const allFour = [p.nationality].concat(groupOpponents);
    state.nationalTournament = {
      competition, nationality: p.nationality, allFour,
      stage: 'group', table: League.createTable(allFour),
      rounds: DB.roundRobinSchedule(allFour, false), roundIndex: 0,
      knockoutRound: null, usedOpponents: allFour.slice(),
      finished: false, champion: false, eliminated: false,
    };
  }

  // Returns the next thing to do for an in-progress national tournament:
  // either a match to play, or a signal that it just concluded.
  function prepareNationalTournamentRound() {
    const nt = state.nationalTournament;
    if (!nt || nt.finished) return { tournamentOver: true };

    if (nt.stage === 'group') {
      if (nt.roundIndex >= nt.rounds.length) {
        const standings = League.sortedStandings(nt.table, id => DB.getNationalTeam(id));
        const myRank = standings.findIndex(s => s.clubId === nt.nationality);
        if (myRank < 2) { nt.stage = 'knockout'; nt.knockoutRound = 'quarter'; return prepareNationalTournamentRound(); }
        nt.finished = true; nt.eliminated = true;
        pushNews('Eliminado na fase de grupos', `${nt.nationality} não avança na ${nt.competition}.`);
        state.nationalTournament = null;
        save();
        return { tournamentOver: true, eliminated: true };
      }
      const round = nt.rounds[nt.roundIndex];
      const pair = round.find(pr => pr.home === nt.nationality || pr.away === nt.nationality);
      round.forEach(pr => {
        if (pr === pair) return;
        const a = DB.getNationalTeam(pr.home), b = DB.getNationalTeam(pr.away);
        const r = League.simulateCpuMatch(a, b);
        League.applyResult(nt.table, pr.home, pr.away, r.homeGoals, r.awayGoals);
      });
      const oppNat = pair.home === nt.nationality ? pair.away : pair.home;
      return { needsMatch: true, stage: 'group', roundNumber: nt.roundIndex + 1, totalRounds: nt.rounds.length, opponentNationality: oppNat, isHome: pair.home === nt.nationality };
    }

    // Knockout: semifinal then final, against a strong opponent not yet faced.
    const remainingPool = DB.allNationTeamNationalities().filter(n => n !== nt.nationality && !nt.usedOpponents.includes(n));
    const pool = remainingPool.length ? remainingPool : DB.allNationTeamNationalities().filter(n => n !== nt.nationality);
    const oppNat = pool[Math.floor(Math.random() * pool.length)];
    nt.usedOpponents.push(oppNat);
    return { needsMatch: true, stage: nt.knockoutRound, opponentNationality: oppNat, isHome: Math.random() < 0.5 };
  }

  function beginNationalTournamentMatch(roundInfo) {
    const p = state.player;
    const myTeam = DB.getNationalTeam(p.nationality);
    const oppTeam = DB.getNationalTeam(roundInfo.opponentNationality);
    const timeline = Events.buildMatchTimeline(p, myTeam, oppTeam, roundInfo.isHome);
    state.currentMatch = {
      timeline, index: 0, score: { for: 0, against: 0 },
      ctx: { stats: { goals: 0, assists: 0, yellow: 0, red: 0 }, injury: null },
      log: [], lastMood: 0, isHome: roundInfo.isHome, unavailable: false,
      isNational: true, isTournament: true, competition: state.nationalTournament.competition,
      stage: roundInfo.stage, myTeam, oppTeam,
    };
    save();
    return nextEventPacket();
  }

  function concludeNationalTournamentMatch() {
    const m = state.currentMatch;
    const p = state.player;
    const nt = state.nationalTournament;
    const rating = computeRating(m, m.ctx.stats.goals, m.ctx.stats.assists);
    p.caps += 1; p.goalsNT = (p.goalsNT || 0) + m.ctx.stats.goals;
    p.popularity = PlayerModel.clamp(p.popularity + m.ctx.stats.goals * 1.5 + 2.5, 0, 100);
    p.form = PlayerModel.clamp(p.form + (rating - 6.5) * 2, 20, 99);

    const oppNat = m.oppTeam.shortName;
    const homeGoals = m.isHome ? m.score.for : m.score.against;
    const awayGoals = m.isHome ? m.score.against : m.score.for;
    const homeTeam = m.isHome ? m.myTeam.name : m.oppTeam.name;
    const awayTeam = m.isHome ? m.oppTeam.name : m.myTeam.name;

    const summary = {
      played: true, competition: nt.competition, isNational: true, isTournament: true, stage: m.stage,
      homeTeam, awayTeam, homeGoals, awayGoals,
      playerGoals: m.ctx.stats.goals, playerAssists: m.ctx.stats.assists, rating, log: m.log,
    };

    if (m.stage === 'group') {
      const homeId = m.isHome ? nt.nationality : oppNat;
      const awayId = m.isHome ? oppNat : nt.nationality;
      League.applyResult(nt.table, homeId, awayId, homeGoals, awayGoals);
      nt.roundIndex += 1;
      summary.groupStanding = League.sortedStandings(nt.table, id => DB.getNationalTeam(id));
    } else if (m.stage === 'quarter' || m.stage === 'semi' || m.stage === 'final') {
      let us = m.score.for, them = m.score.against;
      if (us === them) {
        summary.wentToExtraTime = true;
        us += League.poissonish(0.35); them += League.poissonish(0.35);
        if (us === them) {
          summary.wentToPenalties = true;
          const weWin = Math.random() < 0.5;
          let a = 3 + Math.floor(Math.random() * 3), b = 3 + Math.floor(Math.random() * 3);
          if (weWin && a <= b) a = b + 1; if (!weWin && b <= a) b = a + 1;
          summary.penaltyScore = { us: weWin ? a : b, them: weWin ? b : a, weWin };
          if (weWin) us += 1; else them += 1;
        }
      }
      summary.homeGoals = m.isHome ? us : them; summary.awayGoals = m.isHome ? them : us;
      const weAdvance = us > them;
      if (m.stage === 'final') {
        nt.finished = true;
        if (weAdvance) {
          nt.champion = true; summary.championWon = true;
          state.player.trophies.push(`${nt.competition} — ${state.year}`);
          pushNews('🏆 CAMPEÃO!', `${nt.nationality} conquista a ${nt.competition} com ${p.name} em campo!`);
        } else {
          summary.eliminated = true;
          pushNews('Vice-campeão', `${nt.nationality} perde a final da ${nt.competition}.`);
        }
      } else if (weAdvance) {
        nt.knockoutRound = m.stage === 'quarter' ? 'semi' : 'final';
        summary.advanced = true;
      } else {
        nt.finished = true; nt.eliminated = true; summary.eliminated = true;
        pushNews('Eliminado', `${nt.nationality} cai ${m.stage === 'quarter' ? 'nas quartas de final' : 'na semifinal'} da ${nt.competition}.`);
      }
    }

    pushNews('Seleção', `${p.name} atua por ${m.myTeam.shortName} (${nt.competition}): ${homeTeam} ${summary.homeGoals}x${summary.awayGoals} ${awayTeam}.`);
    state.currentMatch = null;
    if (nt.finished) state.nationalTournament = null;
    save();
    return summary;
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
    const base = Math.max(0, (pl.overall - 45) / 50) * 34 * w;
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
    const progress = Math.max(0.08, Math.min(1, state.week / 40));
    const p = state.player;
    const UEFA_LEAGUES = DB.CONTINENTAL.UEFA.leagues.filter(l => DB.LEAGUES[l]); // only the 7 with a simulated domestic league
    const playerIsEuropean = UEFA_LEAGUES.includes(state.league);

    // ---- Bola de Ouro / Chuteira de Ouro — Europe-based players only,
    // same as the real award in practice — sampled across all 7 leagues.
    const candidateClubs = [];
    UEFA_LEAGUES.forEach(code => {
      candidateClubs.push(...DB.clubsByLeague(code).slice().sort((a, b) => b.reputation - a.reputation).slice(0, 4));
    });
    const attackPool = [], generalPool = [];
    candidateClubs.forEach(c => {
      const squad = c.id === state.club.id ? state.squad : PlayerModel.generateSquad(c);
      squad.filter(pl => ['ATA', 'PE', 'PD', 'MEIA'].includes(pl.position)).sort((a, b) => b.overall - a.overall).slice(0, 2)
        .forEach(pl => attackPool.push({ pl, club: c }));
      squad.slice().sort((a, b) => b.overall - a.overall).slice(0, 2).forEach(pl => generalPool.push({ pl, club: c }));
    });

    const scorers = attackPool.map(({ pl, club }) => ({ name: pl.name, club, goals: estimateGoals(pl, progress) }));
    if (playerIsEuropean) scorers.push({ name: p.name, club: state.club, goals: p.seasonStats.goals, isCareer: true });
    scorers.sort((a, b) => b.goals - a.goals);

    const ballonPool = generalPool.concat(attackPool);
    const ballonDor = ballonPool.map(({ pl, club }) => ({
      name: pl.name, club, score: estimateGoals(pl, progress) * 2 + estimateAssists(pl, progress) * 1.5 + pl.overall * 0.3,
    }));
    if (playerIsEuropean) ballonDor.push({ name: p.name, club: state.club, score: p.seasonStats.goals * 2 + p.seasonStats.assists * 1.5 + p.overall * 0.3 + (state.trophyLog.length * 5), isCareer: true });
    ballonDor.sort((a, b) => b.score - a.score);
    const seenBallon = new Set();
    const ballonDeduped = ballonDor.filter(r => { const k = r.name + (r.club ? r.club.id : ''); if (seenBallon.has(k)) return false; seenBallon.add(k); return true; });

    // ---- Luva de Ouro — kept global (only shown if the player is a keeper)
    const keeperPool = [];
    candidateClubs.forEach(c => {
      const squad = c.id === state.club.id ? state.squad : PlayerModel.generateSquad(c);
      const keeper = squad.filter(pl => pl.position === 'GOL').sort((a, b) => b.overall - a.overall)[0];
      if (keeper) keeperPool.push({ pl: keeper, club: c });
    });
    const keepers = keeperPool.map(({ pl, club }) => {
      const est = estimateConceded(pl, progress);
      return { name: pl.name, club, conceded: est.conceded, matches: est.matches };
    });
    if (p.position === 'GOL' && playerIsEuropean) keepers.push({ name: p.name, club: state.club, conceded: Math.round((p.seasonStats.matches || 0) * 1.1), matches: p.seasonStats.matches, isCareer: true });
    keepers.sort((a, b) => a.conceded - b.conceded);

    // ---- Artilheiro / Líder de assistências — every league has these,
    // regardless of confederation, sampled from the player's own league.
    const myLeagueClubs = DB.clubsByLeague(state.league);
    const myLeaguePool = [];
    myLeagueClubs.forEach(c => {
      const squad = c.id === state.club.id ? state.squad : PlayerModel.generateSquad(c);
      squad.filter(pl => ['ATA', 'PE', 'PD', 'MEIA', 'MC'].includes(pl.position)).sort((a, b) => b.overall - a.overall).slice(0, 2)
        .forEach(pl => myLeaguePool.push({ pl, club: c }));
    });
    const artilheiroLiga = myLeaguePool.map(({ pl, club }) => ({ name: pl.name, club, goals: estimateGoals(pl, progress) }));
    artilheiroLiga.push({ name: p.name, club: state.club, goals: p.seasonStats.goals, isCareer: true });
    artilheiroLiga.sort((a, b) => b.goals - a.goals);

    const assistLiderLiga = myLeaguePool.map(({ pl, club }) => ({ name: pl.name, club, assists: estimateAssists(pl, progress) }));
    assistLiderLiga.push({ name: p.name, club: state.club, assists: p.seasonStats.assists, isCareer: true });
    assistLiderLiga.sort((a, b) => b.assists - a.assists);

    return {
      chuteiraDeOuro: scorers.slice(0, 10),
      bolaDeOuro: ballonDeduped.slice(0, 10),
      luvaDeOuro: p.position === 'GOL' ? keepers.slice(0, 10) : null,
      artilheiroLiga: artilheiroLiga.slice(0, 10),
      assistLiderLiga: assistLiderLiga.slice(0, 10),
      leagueName: DB.LEAGUES[state.league].name,
      playerIsEuropean,
    };
  }

  const INTERVIEW_TEMPLATES = [
    { prompt: 'Você teve uma atuação de gala hoje. Como se sente?', options: [
      { key: 'humilde', label: '"O mérito é todo do grupo."' }, { key: 'confiante', label: '"Sei do meu potencial, trabalho pra isso."' },
      { key: 'motivacional', label: '"Isso é só o começo, vamos com tudo!"' }, { key: 'critico', label: '"Podia ter feito ainda mais."' } ] },
    { prompt: 'A torcida está eufórica com o seu desempenho. O que você diria a eles?', options: [
      { key: 'humilde', label: '"Agradeço demais o carinho, é pra vocês."' }, { key: 'confiante', label: '"Vim pra ser decisivo, e é isso que faço."' },
      { key: 'motivacional', label: '"Vamos em busca de coisas ainda maiores juntos!"' }, { key: 'critico', label: '"Torcida cobra, e é justo, tenho que evoluir mais."' } ] },
    { prompt: 'Grandes clubes já monitoram seu desempenho. Como lida com isso?', options: [
      { key: 'humilde', label: '"Meu foco é só no meu time agora."' }, { key: 'confiante', label: '"É natural, meu nível fala por mim."' },
      { key: 'motivacional', label: '"Isso me motiva a treinar ainda mais forte."' }, { key: 'critico', label: '"Prefiro nem comentar especulações."' } ] },
    { prompt: 'O time vem de uma sequência de bons resultados. Qual o segredo?', options: [
      { key: 'humilde', label: '"É trabalho duro do elenco inteiro."' }, { key: 'confiante', label: '"Temos um time preparado pra vencer qualquer um."' },
      { key: 'motivacional', label: '"O grupo está unido e focado no objetivo."' }, { key: 'critico', label: '"Ainda temos muito o que melhorar, apesar dos resultados."' } ] },
    { prompt: 'Você foi decisivo mais uma vez. Já pensa em disputar prêmios individuais?', options: [
      { key: 'humilde', label: '"Prefiro focar nos títulos do time."' }, { key: 'confiante', label: '"Por que não? Estou trabalhando pra isso."' },
      { key: 'motivacional', label: '"Se continuar assim, os prêmios vêm naturalmente."' }, { key: 'critico', label: '"Ainda falta consistência pra pensar nisso."' } ] },
    { prompt: 'Como está sua relação com o técnico depois desse resultado?', options: [
      { key: 'humilde', label: '"Ele confia em mim e eu retribuo em campo."' }, { key: 'confiante', label: '"Tenho o respeito dele porque entrego resultado."' },
      { key: 'motivacional', label: '"A gente se entende cada vez melhor, e isso aparece no jogo."' }, { key: 'critico', label: '"Ainda temos ajustes a fazer na comunicação."' } ] },
    { prompt: 'O que você diria aos jovens que sonham em seguir seus passos?', options: [
      { key: 'humilde', label: '"Que trabalhem em silêncio e deixem o talento falar."' }, { key: 'confiante', label: '"Que acreditem no potencial deles, igual eu acredito no meu."' },
      { key: 'motivacional', label: '"Que nunca desistam, o sonho vale a pena!"' }, { key: 'critico', label: '"Que se preparem, porque não é fácil como parece."' } ] },
    { prompt: 'A imprensa especula sobre uma possível convocação para a Seleção. Comenta?', options: [
      { key: 'humilde', label: '"Não depende de mim, é decisão do técnico."' }, { key: 'confiante', label: '"Estou pronto se a chance aparecer."' },
      { key: 'motivacional', label: '"Seria a realização de um sonho, vou continuar trabalhando por isso."' }, { key: 'critico', label: '"Prefiro focar no meu clube por enquanto."' } ] },
    { prompt: 'Depois desse resultado, quais são os próximos objetivos da equipe?', options: [
      { key: 'humilde', label: '"Um jogo de cada vez, sem se empolgar."' }, { key: 'confiante', label: '"Estamos de olho no título, sem medo de dizer."' },
      { key: 'motivacional', label: '"Vamos com tudo pra buscar mais vitórias!"' }, { key: 'critico', label: '"Precisamos manter os pés no chão e trabalhar mais."' } ] },
  ];
  function pickInterviewTemplate() { return DB.pick(INTERVIEW_TEMPLATES); }

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
    updateQualificationFromSeason();
    p.seasonStats = PlayerModel.freshSeasonStats();
    p.age += 1;
    state.majorTournamentsThisYear = [];
    state.season += 1;
    state.year += 1;
    state.week = 1;

    if (Transfers.contractYearsLeft(p.contract, state.year) <= 0) {
      state.status = 'contract_decision';
      save();
      return { needsContractDecision: true };
    }
    buildCompetitions();
    pushNews('Nova temporada', `Temporada ${state.season} do ${state.club.name} começa agora.`);
    save();
    return { needsContractDecision: false };
  }

  // -----------------------------------------------------------------------
  // END-OF-CONTRACT: renew with the current club, or pick a league and
  // negotiate with one of the clubs interested in signing the player.
  // -----------------------------------------------------------------------
  // -----------------------------------------------------------------------
  // CLUB RELATIONSHIP — mid-contract requests. Each has a chance of being
  // accepted based on form/morale/popularity; a refusal always costs morale.
  // -----------------------------------------------------------------------
  function requestRaise() {
    const p = state.player;
    const score = p.form * 0.3 + p.popularity * 0.3 + p.overall * 0.3 + (state.trophyLog.length * 4);
    const accepted = Math.random() < PlayerModel.clamp((score - 50) / 70, 0, 0.9);
    if (accepted) {
      const raise = 1.08 + Math.random() * 0.22;
      p.contract.wageWeekly = Math.round(p.contract.wageWeekly * raise);
      p.morale = PlayerModel.clamp(p.morale + 4, 0, 100);
    } else {
      p.morale = PlayerModel.clamp(p.morale - 6, 0, 100);
    }
    save();
    return { accepted, moraleDropped: !accepted, message: accepted ? `O clube aceitou! Novo salário: ${formatMoney(p.contract.wageWeekly)}/semana.` : 'O clube recusou o pedido de aumento salarial.' };
  }

  function requestEarlyRenewal() {
    const p = state.player;
    const offer = getRenewalOffer();
    const score = p.morale * 0.35 + p.form * 0.3 + p.overall * 0.2 + 15;
    const accepted = Math.random() < PlayerModel.clamp(score / 100, 0, 0.9);
    if (accepted) {
      p.contract = offer;
      p.morale = PlayerModel.clamp(p.morale + 3, 0, 100);
    } else {
      p.morale = PlayerModel.clamp(p.morale - 3, 0, 100);
    }
    save();
    return { accepted, moraleDropped: !accepted, offer, message: accepted ? `Renovação antecipada aceita! Contrato até ${offer.startYear + offer.years}.` : 'O clube preferiu não renovar seu contrato agora.' };
  }

  function requestToLeave() {
    const p = state.player;
    const score = (100 - p.morale) * 0.4 + (p.form < 50 ? 20 : 0) + Math.random() * 25;
    const accepted = Math.random() < PlayerModel.clamp(score / 75, 0, 0.85);
    if (accepted) {
      state.status = 'contract_decision';
      state.player.contract = null;
    } else {
      p.morale = PlayerModel.clamp(p.morale - 8, 0, 100);
    }
    save();
    return { accepted, moraleDropped: !accepted, message: accepted ? 'O clube concordou em liberar você! Escolha seu próximo destino.' : 'O clube recusou seu pedido de saída.' };
  }

  function getRenewalOffer() {
    return Transfers.makeContract(state.club, state.player, {
      years: 2 + Math.floor(Math.random() * 3), wageMultiplier: 0.9 + Math.random() * 0.6, startYear: state.year,
    });
  }

  function renewContract(contractOffer) {
    state.player.contract = contractOffer;
    buildCompetitions();
    pushNews('Renovação de contrato', `${state.player.name} renova com o ${state.club.name} até ${contractOffer.startYear + contractOffer.years}.`);
    state.status = 'in_career';
    save();
  }

  function getInterestedClubs(leagueCode) {
    const pool = DB.clubsByLeague(leagueCode).filter(c => c.id !== state.club.id);
    const scored = pool.map(c => ({ club: c, fit: Math.abs(c.reputation - state.player.overall) })).sort((a, b) => a.fit - b.fit);
    return shuffleArr(scored.slice(0, 8)).slice(0, 3).map(x => x.club);
  }

  function getClubOffer(club) {
    return Transfers.makeContract(club, state.player, { years: 3, wageMultiplier: 1 + Math.random() * 0.4, startYear: state.year });
  }

  function signWithNewClub(club, negotiatedContract) {
    const contractOffer = negotiatedContract || getClubOffer(club);
    state.club = club; state.league = club.league;
    state.squad = PlayerModel.generateSquad(club);
    state.player.contract = contractOffer;
    buildCompetitions();
    pushNews('Nova equipe!', `${state.player.name} assina com o ${club.name}.`);
    state.status = 'in_career';
    save();
  }

  // -----------------------------------------------------------------------
  // CALENDAR PREVIEW — for each still-active competition, peeks at the next
  // round to find the player's club's fixture, without mutating any state
  // (used by the calendar view; the actual simulation happens in
  // prepareRound/concludeRound when the person plays that round for real).
  // -----------------------------------------------------------------------
  function getUpcomingFixtures() {
    const out = [];
    ['estadual', 'liga', 'copa', 'continental'].forEach(topKey => {
      const top = state.competitions[topKey];
      if (!top || top.champion) return;
      let obj = top, roundsArr = null, idx = 0;
      if (top.type === 'grupos') {
        if (top.knockout) { obj = top.knockout; roundsArr = obj.rounds; idx = obj.roundIndex; }
        else if (top.isSwiss) { roundsArr = top.rounds; idx = top.roundIndex; }
        else {
          const myGroup = top.groups.find(g => g.clubIds.includes(state.club.id));
          if (myGroup) { roundsArr = myGroup.rounds; idx = top.roundIndex; }
        }
      } else {
        roundsArr = top.rounds; idx = top.roundIndex;
      }
      if (!roundsArr || idx >= roundsArr.length) return;
      const round = roundsArr[idx];
      const pair = round && round.find(p => p.home === state.club.id || p.away === state.club.id);
      if (!pair) { out.push({ competition: top.name, opponent: null, bye: true }); return; }
      const oppId = pair.home === state.club.id ? pair.away : pair.home;
      const opponent = oppId ? DB.CLUBS.find(c => c.id === oppId) : null;
      out.push({ competition: top.name, opponent, isHome: pair.home === state.club.id, bye: !opponent });
    });
    return out;
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
    beginNationalMatch, concludeNationalMatch, prepareNationalTournamentRound, beginNationalTournamentMatch, concludeNationalTournamentMatch,
    train, endSeason, getRenewalOffer, renewContract, requestRaise, requestEarlyRenewal, requestToLeave, getInterestedClubs, getClubOffer, signWithNewClub,
    acceptTransfer, rejectTransfer, acceptSponsor, rejectSponsor,
    acceptCallUp, declineCallUp, answerInterview, getStandings, getBracket, getAwardRaces, getUpcomingFixtures, qualificationTierFor,
    save, load, hasSave, wipeSave, getState, formatMoney, TRAINING_PLANS,
  };
})();
