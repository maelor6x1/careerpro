/**
 * league.js
 * ---------------------------------------------------------------------------
 * Simulates the competition around the career player: every other match in
 * the round (not just the player's), keeps a real points table for league
 * phases, and resolves single-elimination brackets for cups. The player's
 * own match is simulated separately (interactively, via events.js) and its
 * final score is fed back in through League.applyResult like any other game.
 * ---------------------------------------------------------------------------
 */

const League = (() => {

  function createTable(clubIds) {
    const table = {};
    clubIds.forEach(id => {
      table[id] = { clubId: id, pj: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, pts: 0 };
    });
    return table;
  }

  function applyResult(table, homeId, awayId, homeGoals, awayGoals) {
    if (!table[homeId] || !table[awayId]) return;
    const h = table[homeId], a = table[awayId];
    h.pj++; a.pj++; h.gp += homeGoals; h.gc += awayGoals; a.gp += awayGoals; a.gc += homeGoals;
    if (homeGoals > awayGoals) { h.v++; h.pts += 3; a.d++; }
    else if (homeGoals < awayGoals) { a.v++; a.pts += 3; h.d++; }
    else { h.e++; a.e++; h.pts += 1; a.pts += 1; }
  }

  function sortedStandings(table, clubLookup) {
    return Object.values(table)
      .map(row => Object.assign({}, row, { sg: row.gp - row.gc, club: clubLookup(row.clubId) }))
      .sort((x, y) => y.pts - x.pts || y.sg - x.sg || y.gp - x.gp);
  }

  // -----------------------------------------------------------------------
  // CPU vs CPU score — driven by club reputation, with enough randomness
  // that underdogs win their share of matches.
  // -----------------------------------------------------------------------
  function simulateCpuMatch(clubA, clubB) {
    const strengthA = clubA.reputation + rand(-5, 5);
    const strengthB = clubB.reputation + rand(-5, 5);
    const diff = strengthA - strengthB;
    const golsA = poissonish(1.25 + diff * 0.045);
    const golsB = poissonish(1.25 - diff * 0.045);
    return { homeGoals: golsA, awayGoals: golsB };
  }

  function poissonish(mean) {
    const m = Math.max(0.15, mean);
    let goals = 0, threshold = Math.exp(-m), p = 1;
    do { p *= Math.random(); if (p > threshold) goals++; } while (p > threshold && goals < 8);
    return goals;
  }

  function rand(min, max) { return Math.round(min + Math.random() * (max - min)); }

  // -----------------------------------------------------------------------
  // LEAGUE PHASE (round-robin) — clubIds must already be scoped to a single
  // league/state group by the caller.
  // -----------------------------------------------------------------------
  function buildLeaguePhase(name, clubIds, doubleRound) {
    return {
      type: 'liga', name, clubIds,
      table: createTable(clubIds),
      rounds: DB.roundRobinSchedule(clubIds, !!doubleRound),
      roundIndex: 0, champion: null,
    };
  }

  // Simulates every fixture in the current round except the one belonging
  // to `skipClubId` (the player's club, resolved separately). Returns the
  // pairing that involves skipClubId, if any, plus the list of results
  // applied so the UI can show "outros resultados da rodada".
  function simulateLeagueRound(phase, skipClubId) {
    if (phase.roundIndex >= phase.rounds.length) return { done: true };
    const round = phase.rounds[phase.roundIndex];
    let playerFixture = null;
    const otherResults = [];
    round.forEach(pair => {
      if (pair.home === skipClubId || pair.away === skipClubId) { playerFixture = pair; return; }
      const clubA = DB.CLUBS.find(c => c.id === pair.home), clubB = DB.CLUBS.find(c => c.id === pair.away);
      if (!clubA || !clubB) return;
      const { homeGoals, awayGoals } = simulateCpuMatch(clubA, clubB);
      applyResult(phase.table, pair.home, pair.away, homeGoals, awayGoals);
      otherResults.push({ home: clubA.name, away: clubB.name, homeGoals, awayGoals });
    });
    return { done: false, playerFixture, otherResults, roundNumber: phase.roundIndex + 1, totalRounds: phase.rounds.length };
  }

  function finishLeagueRound(phase) {
    phase.roundIndex += 1;
    if (phase.roundIndex >= phase.rounds.length) {
      const standings = sortedStandings(phase.table, id => DB.CLUBS.find(c => c.id === id));
      phase.champion = standings[0] ? standings[0].clubId : null;
      return { phaseOver: true, champion: phase.champion };
    }
    return { phaseOver: false };
  }

  // -----------------------------------------------------------------------
  // CUP PHASE (single elimination) — bracket rounds are generated lazily:
  // round 1 is seeded up front, later rounds are built from the previous
  // round's winners once it's fully resolved.
  // -----------------------------------------------------------------------
  function buildCupPhase(name, clubIds) {
    return {
      type: 'copa', name, clubIds,
      rounds: [DB.knockoutBracket(clubIds)],
      roundIndex: 0, champion: null, results: [],
    };
  }

  function simulateCupRound(phase, skipClubId) {
    const round = phase.rounds[phase.roundIndex];
    if (!round) return { done: true };
    let playerFixture = null;
    const resolved = [];
    round.forEach(pair => {
      if (pair.home === skipClubId || pair.away === skipClubId) { playerFixture = pair; return; }
      resolved.push(resolveCupPair(pair));
    });
    return { done: false, playerFixture, resolved, roundNumber: phase.roundIndex + 1, totalRounds: Math.log2(phase.rounds[0].length * 2) };
  }

  function resolveCupPair(pair) {
    if (pair.home && !pair.away) return { pair, winner: pair.home, bye: true };
    if (!pair.home && pair.away) return { pair, winner: pair.away, bye: true };
    if (!pair.home && !pair.away) return { pair, winner: null, bye: true };
    const clubA = DB.CLUBS.find(c => c.id === pair.home), clubB = DB.CLUBS.find(c => c.id === pair.away);
    let { homeGoals, awayGoals } = simulateCpuMatch(clubA, clubB);
    let extraTime = false, penalties = false;
    if (homeGoals === awayGoals) {
      extraTime = true;
      homeGoals += poissonish(0.35); awayGoals += poissonish(0.35);
      if (homeGoals === awayGoals) {
        penalties = true;
        const winner = Math.random() < 0.5 ? pair.home : pair.away;
        let a = 3 + Math.floor(Math.random() * 3), b = 3 + Math.floor(Math.random() * 3);
        if (winner === pair.home && a <= b) a = b + 1; if (winner === pair.away && b <= a) b = a + 1;
        return { pair, winner, homeGoals, awayGoals, penalties, extraTime, penaltyHome: a, penaltyAway: b, home: clubA.name, away: clubB.name };
      }
    }
    return { pair, winner: homeGoals > awayGoals ? pair.home : pair.away, homeGoals, awayGoals, extraTime, penalties, home: clubA.name, away: clubB.name };
  }

  // `roundResults` must cover every pair of the current round (the CPU
  // pairs already resolved by simulateCupRound, plus the player's own pair
  // once its interactive match is over) — each entry at minimum { pair, winner }.
  function finishCupRound(phase, roundResults) {
    const round = phase.rounds[phase.roundIndex];
    const winners = round.map(pair => {
      const found = roundResults.find(r => r.pair === pair);
      if (found) return found.winner;
      if (pair.home === null) return pair.away;
      if (pair.away === null) return pair.home;
      return null;
    });
    const clean = winners.filter(w => w !== null);
    phase.roundIndex += 1;
    if (clean.length <= 1) {
      phase.champion = clean[0] || null;
      return { phaseOver: true, champion: phase.champion };
    }
    phase.rounds.push(DB.knockoutBracket(clean));
    return { phaseOver: false };
  }

  return {
    createTable, applyResult, sortedStandings, simulateCpuMatch, poissonish,
    buildLeaguePhase, simulateLeagueRound, finishLeagueRound,
    buildCupPhase, simulateCupRound, resolveCupPair, finishCupRound,
    buildGroupStagePhase, simulateGroupStageRound, finishGroupStageRound,
    buildSwissPhase, simulateSwissRound, finishSwissRound,
  };

  // -----------------------------------------------------------------------
  // GROUP STAGE (Libertadores-style) — clubIds split into groups of
  // `groupSize` (default 4), each group plays a double round-robin, top 2
  // per group advance into a knockout bracket built once the last group
  // round is resolved.
  // -----------------------------------------------------------------------
  function buildGroupStagePhase(name, clubIds, groupSize) {
    groupSize = groupSize || 4;
    const shuffled = clubIds.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const groups = [];
    for (let i = 0; i < shuffled.length; i += groupSize) {
      const ids = shuffled.slice(i, i + groupSize);
      if (ids.length < 2) continue;
      groups.push({
        name: `Grupo ${String.fromCharCode(65 + groups.length)}`, clubIds: ids,
        table: createTable(ids), rounds: DB.roundRobinSchedule(ids, ids.length <= 5),
      });
    }
    const groupRoundsTotal = groups.length ? Math.max(...groups.map(g => g.rounds.length)) : 0;
    return { type: 'grupos', name, groups, groupRoundsTotal, roundIndex: 0, knockout: null, champion: null };
  }

  function findPlayerGroup(phase, clubId) { return phase.groups.find(g => g.clubIds.includes(clubId)); }

  function simulateGroupStageRound(phase, skipClubId) {
    if (phase.roundIndex >= phase.groupRoundsTotal) return { done: true };
    let playerFixture = null, playerGroup = null;
    const otherResults = [];
    phase.groups.forEach(g => {
      const round = g.rounds[phase.roundIndex];
      if (!round) return;
      round.forEach(pair => {
        if (pair.home === skipClubId || pair.away === skipClubId) { playerFixture = pair; playerGroup = g; return; }
        const clubA = DB.CLUBS.find(c => c.id === pair.home), clubB = DB.CLUBS.find(c => c.id === pair.away);
        if (!clubA || !clubB) return;
        const { homeGoals, awayGoals } = simulateCpuMatch(clubA, clubB);
        applyResult(g.table, pair.home, pair.away, homeGoals, awayGoals);
        otherResults.push({ home: clubA.name, away: clubB.name, homeGoals, awayGoals });
      });
    });
    return { done: false, playerFixture, playerGroup, otherResults, roundNumber: phase.roundIndex + 1, totalRounds: phase.groupRoundsTotal };
  }

  function finishGroupStageRound(phase) {
    phase.roundIndex += 1;
    if (phase.roundIndex >= phase.groupRoundsTotal) {
      const qualifiers = [];
      phase.groups.forEach(g => {
        const standings = sortedStandings(g.table, id => DB.CLUBS.find(c => c.id === id));
        if (standings[0]) qualifiers.push(standings[0].clubId);
        if (standings[1]) qualifiers.push(standings[1].clubId);
      });
      phase.knockout = buildCupPhase(phase.name + ' — Mata-mata', qualifiers);
      return { groupStageOver: true };
    }
    return { groupStageOver: false };
  }

  // -----------------------------------------------------------------------
  // SWISS-STYLE LEAGUE PHASE (Champions/Europa League format since 2024) —
  // every club plays a fixed number of different opponents (not everyone),
  // sharing one table. Reusing the round-robin generator and just taking
  // its first `numOpponents` rounds gives each club exactly that many
  // distinct opponents for free. Top 8 go straight to the knockout;
  // 9th-24th get a single playoff match first; the rest are out.
  // -----------------------------------------------------------------------
  function buildSwissPhase(name, clubIds, numOpponents) {
    numOpponents = Math.min(numOpponents || 8, clubIds.length - 1);
    const fullSchedule = DB.roundRobinSchedule(clubIds, false);
    const rounds = fullSchedule.slice(0, numOpponents);
    return { type: 'grupos', name, isSwiss: true, clubIds, table: createTable(clubIds), rounds, groupRoundsTotal: rounds.length, roundIndex: 0, knockout: null, playoff: null, champion: null };
  }

  function simulateSwissRound(phase, skipClubId) {
    if (phase.roundIndex >= phase.rounds.length) return { done: true };
    const round = phase.rounds[phase.roundIndex];
    let playerFixture = null;
    const otherResults = [];
    round.forEach(pair => {
      if (pair.home === skipClubId || pair.away === skipClubId) { playerFixture = pair; return; }
      const clubA = DB.CLUBS.find(c => c.id === pair.home), clubB = DB.CLUBS.find(c => c.id === pair.away);
      if (!clubA || !clubB) return;
      const { homeGoals, awayGoals } = simulateCpuMatch(clubA, clubB);
      applyResult(phase.table, pair.home, pair.away, homeGoals, awayGoals);
      otherResults.push({ home: clubA.name, away: clubB.name, homeGoals, awayGoals });
    });
    return { done: false, playerFixture, otherResults, roundNumber: phase.roundIndex + 1, totalRounds: phase.rounds.length };
  }

  function finishSwissRound(phase) {
    phase.roundIndex += 1;
    if (phase.roundIndex >= phase.rounds.length) {
      const standings = sortedStandings(phase.table, id => DB.CLUBS.find(c => c.id === id));
      const qualifiers = standings.slice(0, Math.min(8, standings.length)).map(s => s.clubId);
      phase.knockout = buildCupPhase(phase.name + ' — Mata-mata', qualifiers);
      return { groupStageOver: true };
    }
    return { groupStageOver: false };
  }
})();
