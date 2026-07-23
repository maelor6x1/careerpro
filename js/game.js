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

    const matchInfo = {
      club: Career.getState().club, opponent: packet.opponent, isHome: packet.isHome,
      competition: packet.competition, roundNumber: packet.roundNumber, totalRounds: packet.totalRounds,
    };
    const firstStep = Career.beginPlayerMatch();
    playBeat(matchInfo, firstStep);
  }

  function playBeat(matchInfo, step) {
    if (step.matchOver) { finishMatch(matchInfo); return; }
    const beat = step.beat;
    const log = (Career.getState().currentMatch || {}).log || [];
    if (beat.type === 'decision') {
      const ov = UI.renderMatchDecision(matchInfo, beat, log);
      ov.querySelectorAll('[data-opt]').forEach(btn => btn.addEventListener('click', () => {
        const { result, next } = Career.stepMatch(btn.dataset.opt);
        const newLog = (Career.getState().currentMatch || {}).log || [];
        UI.renderMatchResult(matchInfo, result.text, newLog, () => playBeat(matchInfo, next));
      }));
    } else {
      const { result, next } = Career.stepMatch();
      const newLog = (Career.getState().currentMatch || {}).log || [];
      UI.renderMatchResult(matchInfo, result.text, newLog, () => playBeat(matchInfo, next));
    }
  }

  function finishMatch(matchInfo) {
    const summary = Career.concludeRound();
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
      if (item.type === 'transfer_offer') action === 'accept' ? Career.acceptTransfer(item) : Career.rejectTransfer(item);
      if (item.type === 'sponsor_offer') action === 'accept' ? Career.acceptSponsor(item) : Career.rejectSponsor(item);
      if (item.type === 'call_up') action === 'accept' ? Career.acceptCallUp(item) : Career.declineCallUp(item);
      UI.closeOverlay();
      processPopupQueue();
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
