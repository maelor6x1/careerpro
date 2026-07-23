/**
 * transfers.js
 * ---------------------------------------------------------------------------
 * Handles everything money- and career-mobility related: initial club
 * proposals, in-career transfer offers, contract/negotiation logic,
 * sponsorship deals, and national team call-ups.
 * ---------------------------------------------------------------------------
 */

const Transfers = (() => {

  // -----------------------------------------------------------------------
  // Initial club proposals (character creation)
  // -----------------------------------------------------------------------
  function generateInitialProposals(careerPlayer) {
    let pool = DB.clubsByCountry(careerPlayer.nationality);
    if (pool.length === 0) {
      // Nationality has no domestic league in-game: let the player pick any league
      return { needsLeagueChoice: true, clubs: [] };
    }
    // Filter to clubs whose reputation roughly matches the player's overall/potential
    const scored = pool.map(c => ({
      club: c,
      fit: Math.abs(c.reputation - (careerPlayer.overall + (careerPlayer.potential - careerPlayer.overall) * 0.3)),
    })).sort((a, b) => a.fit - b.fit);
    const chosen = scored.slice(0, Math.min(6, scored.length));
    const picks = shuffle(chosen).slice(0, 3).map(x => x.club);
    return { needsLeagueChoice: false, clubs: picks.length ? picks : pool.slice(0, 3) };
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function makeContract(club, player, opts = {}) {
    const baseWage = Math.round((player.overall * player.overall * 60) * (opts.wageMultiplier || 1));
    return {
      clubId: club.id, clubName: club.name,
      wageWeekly: baseWage,
      years: opts.years || 3,
      signingBonus: Math.round(baseWage * 4),
      releaseClause: Math.round(player.marketValue * (opts.clauseMultiplier || 3)),
      startSeason: opts.season || 1,
    };
  }

  // -----------------------------------------------------------------------
  // In-career transfer offers — bigger clubs come calling as reputation,
  // overall, age, market value and popularity grow.
  // -----------------------------------------------------------------------
  function maybeGenerateTransferOffer(state) {
    const p = state.player;
    if (!p.contract) return null;
    const currentClub = DB.CLUBS.find(c => c.id === p.contract.clubId);
    if (!currentClub) return null;

    const interestScore = (p.overall * 1.2) + (p.popularity * 0.4) + ((30 - p.age) * 0.8)
      + (state.trophiesThisCareer || 0) * 3 - currentClub.reputation * 0.3;
    const chance = clamp01((interestScore - 55) / 320);
    if (Math.random() > chance) return null;

    const candidates = DB.CLUBS.filter(c => c.id !== currentClub.id
      && c.reputation >= currentClub.reputation - 4
      && c.reputation <= p.overall + 12);
    if (!candidates.length) return null;
    const suitor = candidates[Math.floor(Math.random() * candidates.length)];

    const fee = Math.round(p.marketValue * (0.9 + Math.random() * 0.6) / 5000) * 5000;
    return {
      club: suitor,
      fee,
      contractOffer: makeContract(suitor, p, { wageMultiplier: 1.1 + Math.random() * 0.3, years: 3 + Math.floor(Math.random() * 3) }),
    };
  }

  function clamp01(v) { return Math.max(0, Math.min(0.9, v)); }

  // -----------------------------------------------------------------------
  // Negotiation: player can push wage / bonus / years / clause up or down
  // within a plausible band before accepting/rejecting.
  // -----------------------------------------------------------------------
  function negotiate(offerContract, field, direction) {
    const step = { wageWeekly: 0.08, signingBonus: 0.12, years: 1, releaseClause: 0.15 }[field];
    const updated = Object.assign({}, offerContract);
    if (field === 'years') {
      updated.years = PlayerModel.clamp(offerContract.years + direction, 1, 6);
    } else {
      const factor = 1 + direction * step;
      updated[field] = Math.max(0, Math.round(offerContract[field] * factor));
    }
    return updated;
  }

  // Club's willingness collapses if pushed too far — returns success + reaction
  function evaluateCounterOffer(original, updated) {
    const wageDelta = (updated.wageWeekly - original.wageWeekly) / original.wageWeekly;
    const clauseDelta = (updated.releaseClause - original.releaseClause) / original.releaseClause;
    const totalAsk = wageDelta + clauseDelta * 0.3;
    if (totalAsk > 0.35) return { accepted: false, reaction: 'O clube considerou a proposta exagerada e recuou na negociação.' };
    if (totalAsk > 0.18) return { accepted: Math.random() > 0.4, reaction: 'O clube hesitou, mas aceitou fechar em um meio-termo.' };
    return { accepted: true, reaction: 'O clube aceitou os novos termos sem grandes problemas.' };
  }

  // -----------------------------------------------------------------------
  // Sponsorships
  // -----------------------------------------------------------------------
  function generateSponsorOffers(player) {
    if (player.popularity < 25) return [];
    if (Math.random() > 0.35) return []; // not every check-in produces an offer
    const eligible = DB.SPONSORS.filter(s => s.tier <= 1 + Math.floor(player.popularity / 35));
    if (!eligible.length) return [];
    const s = pick(eligible);
    return [{
      sponsor: s,
      payment: Math.round((s.tier * 8000 + player.popularity * 900) / 100) * 100,
      bonusPerGoal: Math.round(s.tier * 500),
      durationSeasons: 1 + Math.floor(Math.random() * 2),
      objective: pick([
        'Marcar 10 gols na temporada', 'Ser eleito 3x Craque do Jogo', 'Manter média de nota acima de 7.0',
        'Disputar uma final continental', 'Alcançar 1 milhão de seguidores',
      ]),
    }];
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // -----------------------------------------------------------------------
  // National team call-ups
  // -----------------------------------------------------------------------
  function checkCallUp(player, state) {
    if (player.overall < 72 && player.caps === 0) return null;
    const chance = clamp01((player.overall - 68) / 140 + player.form / 600);
    if (Math.random() > chance) return null;
    const options = DB.nationalCompetitionsFor(player.nationality);
    const competition = pick(options);
    return { competition, nationality: player.nationality };
  }

  return {
    generateInitialProposals, makeContract, maybeGenerateTransferOffer,
    negotiate, evaluateCounterOffer, generateSponsorOffers, checkCallUp,
  };
})();
