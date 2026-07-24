/**
 * game.js
 * ---------------------------------------------------------------------------
 * App entry point. Boots the game, decides whether to resume a save or start
 * fresh, and wires every UI interaction — including driving the interactive
 * match center beat-by-beat — to the Career/Transfers game logic.
 * ---------------------------------------------------------------------------
 */

(function boot() {
  document.addEventListener('DOMContentLoaded', () => {
    if (Career.hasSave() && Career.load() && Career.getState() && Career.getState().status === 'in_career') {
      UI.renderHub(Career.getState());
      wireHubEvents();
    } else {
      showCreate();
    }
  });

  function showCreate() {
    UI.renderCreatePlayer();
    document.getElementById('createForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const form = {
        firstName: fd.get('firstName').trim() || 'Jogador',
        lastName: fd.get('lastName').trim() || 'Anônimo',
        age: parseInt(fd.get('age'), 10),
        nationality: fd.get('nationality'),
        foot: fd.get('foot'),
        height: parseInt(fd.get('height'), 10),
        weight: parseInt(fd.get('weight'), 10),
        position: fd.get('position'),
      };
      const state = Career.startNewCareer(form);
      showProposals(state.player);
    });
  }

  function showProposals(player) {
    const proposals = Transfers.generateInitialProposals(player);
    UI.renderClubProposals(player, proposals, (leagueCode) => {
      const clubs = DB.clubsByLeague(leagueCode).slice(0, 6);
      const picks = shuffle(clubs).slice(0, 3);
      UI.renderClubList(picks, (club) => confirmClub(club));
    });
    if (!proposals.needsLeagueChoice) {
      document.querySelectorAll('[data-choose]').forEach(btn =>
        btn.addEventListener('click', () => confirmClub(proposals.clubs[parseInt(btn.dataset.choose)])));
    }
  }

  function confirmClub(club) {
    Career.chooseClub(club);
    UI.renderHub(Career.getState());
    wireHubEvents();
  }

  function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[b[i], b[j]] = [b[j], b[i]]; } return b; }

  // ---------------------------------------------------------------------
  // HUB EVENT WIRING
  // ---------------------------------------------------------------------
  function wireHubEvents() {
    const content = document.getElementById('tabContent');
    if (!content) return;
    content.addEventListener('click', handleTabClick);
  }

  function handleTabClick(e) {
    const state = Career.getState();

    if (e.target.closest('#btnPlayRound')) { startRound(); return; }
    if (e.target.closest('#btnEndSeason')) { Career.endSeason(); refreshHub(); return; }

    const trainCard = e.target.closest('[data-plan]');
    if (trainCard) {
      const res = Career.train(trainCard.dataset.plan);
      const out = document.getElementById('trainResult');
      if (out) {
        if (!res.ok) out.innerHTML = `<p class="warn">${res.reason}</p>`;
        else {
          const keys = Object.keys(res.gained);
          out.innerHTML = keys.length
            ? `<p class="success">Treino concluído! Ganhos: ${keys.map(k => `${k} +${res.gained[k]}`).join(', ')}</p>`
            : `<p class="muted">Treino concluído, sem evolução desta vez.</p>`;
        }
      }
      refreshHub();
      return;
    }

  }

  // ---------------------------------------------------------------------
  // ROUND / MATCH FLOW
  // ---------------------------------------------------------------------
  function startRound() {
    const packet = Career.prepareRound();
    if (packet.seasonOver) { refreshHub(); return; }

    if (!packet.needsMatch) {
      const summary = Career.concludeRound();
      summary.bye = packet.bye;
      UI.renderRoundSummary(summary, () => processPopupQueue());
      return;
    }

    const state = Career.getState();
    const homeTeamObj = packet.isHome ? state.club : packet.opponent;
    const awayTeamObj = packet.isHome ? packet.opponent : state.club;
    const matchInfo = { homeTeamObj, awayTeamObj, competition: packet.competition, isHome: packet.isHome };
    const first = Career.beginPlayerMatch();
    UI.renderLiveMatch(matchInfo);
    wireLiveMatchSkip(matchInfo, false);
    advanceLiveMatch(matchInfo, first, false);
  }

  function startNationalMatch(competition) {
    const first = Career.beginNationalMatch(competition);
    const m = Career.getState().currentMatch;
    const homeTeamObj = m.isHome ? m.myTeam : m.oppTeam;
    const awayTeamObj = m.isHome ? m.oppTeam : m.myTeam;
    const matchInfo = { homeTeamObj, awayTeamObj, competition, isHome: m.isHome };
    UI.renderLiveMatch(matchInfo);
    wireLiveMatchSkip(matchInfo, true);
    advanceLiveMatch(matchInfo, first, true);
  }

  function wireLiveMatchSkip(matchInfo, isNational) {
    const btn = document.getElementById('liveSkipBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // Fast-forward through non-decision events instantly.
      let packet = Career.peekEvent();
      while (!packet.matchOver && packet.event.kind !== 'decision') {
        const stepped = Career.stepMatch();
        UI.updateLiveClock(stepped.next.event ? stepped.next.event.minute : packet.event.minute);
        UI.updateLiveScore(Career.getState().currentMatch.score, matchInfo.isHome);
        packet = stepped.next;
      }
      if (packet.matchOver) finishLiveMatch(matchInfo, isNational);
      else advanceLiveMatch(matchInfo, packet, isNational, true);
    });
  }

  function advanceLiveMatch(matchInfo, packet, isNational, skipDelay) {
    if (packet.matchOver) { finishLiveMatch(matchInfo, isNational); return; }
    const ev = packet.event;
    UI.updateLiveClock(ev.minute);
    UI.updateLiveScore(packet.score, matchInfo.isHome);

    if (ev.kind === 'decision') {
      UI.clearLiveDecision();
      const el = UI.showLiveDecision(ev);
      el.querySelectorAll('[data-opt]').forEach(btn => btn.addEventListener('click', () => {
        UI.clearLiveDecision();
        const { result, next } = Career.stepMatch(btn.dataset.opt);
        UI.pushLiveTicker(result.text, ev.minute, result.outcome === 'goal' || result.outcome === 'assist');
        UI.updateLiveScore(next.score || Career.getState().currentMatch.score, matchInfo.isHome);
        setTimeout(() => advanceLiveMatch(matchInfo, next, isNational), 450);
      }));
      return;
    }

    const { result, next } = Career.stepMatch();
    const isGoalish = ev.kind === 'ambient_goal_for' || ev.kind === 'ambient_goal_against' || result.outcome === 'goal' || result.outcome === 'assist';
    UI.pushLiveTicker(result.text, ev.minute, isGoalish);
    UI.updateLiveScore(next.score || Career.getState().currentMatch.score, matchInfo.isHome);
    setTimeout(() => advanceLiveMatch(matchInfo, next, isNational), skipDelay ? 0 : 480);
  }

  function finishLiveMatch(matchInfo, isNational) {
    const summary = isNational ? Career.concludeNationalMatch() : Career.concludeRound();
    UI.renderRoundSummary(summary, () => processPopupQueue());
  }

  // ---------------------------------------------------------------------
  // PENDING-DECISIONS POPUP QUEUE — transfer offers, sponsorships,
  // interviews and call-ups surface here, one at a time, right after the
  // round summary closes, instead of sitting in a separate inbox tab.
  // ---------------------------------------------------------------------
  function processPopupQueue() {
    const state = Career.getState();
    if (!state || !state.inbox.length) { refreshHub(); return; }
    const item = state.inbox[0];
    const ov = UI.showDecisionPopup(item);

    ov.querySelectorAll('[data-action^="neg-"]').forEach(btn => btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const field = action.includes('wage') ? 'wageWeekly' : action.includes('years') ? 'years' : 'releaseClause';
      const dir = action.includes('down') ? -1 : 1;
      const updated = Transfers.negotiate(item.data.contractOffer, field, dir);
      const evalRes = Transfers.evaluateCounterOffer(item.data.contractOffer, updated);
      if (evalRes.accepted) item.data.contractOffer = updated;
      alert(evalRes.reaction);
      UI.closeOverlay();
      processPopupQueue();
    }));

    ov.querySelectorAll('[data-action="accept"], [data-action="reject"]').forEach(btn => btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (item.type === 'transfer_offer') { action === 'accept' ? Career.acceptTransfer(item) : Career.rejectTransfer(item); UI.closeOverlay(); processPopupQueue(); return; }
      if (item.type === 'sponsor_offer') { action === 'accept' ? Career.acceptSponsor(item) : Career.rejectSponsor(item); UI.closeOverlay(); processPopupQueue(); return; }
      if (item.type === 'call_up') {
        if (action === 'accept') {
          const data = Career.acceptCallUp(item);
          UI.closeOverlay();
          startNationalMatch(data.competition);
        } else {
          Career.declineCallUp(item);
          UI.closeOverlay();
          processPopupQueue();
        }
        return;
      }
    }));

    ov.querySelectorAll('[data-answer]').forEach(btn => btn.addEventListener('click', () => {
      Career.answerInterview(item, btn.dataset.answer);
      UI.closeOverlay();
      processPopupQueue();
    }));
  }

  function refreshHub() {
    const state = Career.getState();
    if (!state) return;
    UI.renderHub(state);
    wireHubEvents();
  }
})();
