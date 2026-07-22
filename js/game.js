/**
 * game.js
 * ---------------------------------------------------------------------------
 * App entry point. Boots the game, decides whether to resume a save or start
 * fresh, and wires every UI interaction to the Career/Transfers game logic.
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
  // HUB EVENT WIRING — re-attached every time a tab re-renders since the
  // DOM nodes are replaced by innerHTML writes.
  // ---------------------------------------------------------------------
  function wireHubEvents() {
    const content = document.getElementById('tabContent');
    if (!content) return;

    content.addEventListener('click', handleTabClick);
  }

  function handleTabClick(e) {
    const state = Career.getState();

    const playBtn = e.target.closest('#btnPlayMatch');
    if (playBtn) {
      const result = Career.playNextFixture();
      UI.showMatchModal(result, () => refreshHub());
      return;
    }

    const endSeasonBtn = e.target.closest('#btnEndSeason');
    if (endSeasonBtn) { Career.endSeason(); refreshHub(); return; }

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
      refreshHub(true);
      return;
    }

    const inboxCard = e.target.closest('.inbox-card');
    if (inboxCard) {
      const id = inboxCard.dataset.id;
      const item = state.inbox.find(i => i.id === id);
      if (!item) return;

      const negBtn = e.target.closest('[data-action^="neg-"]');
      if (negBtn) {
        const action = negBtn.dataset.action;
        const field = action.includes('wage') ? 'wageWeekly' : action.includes('years') ? 'years' : 'releaseClause';
        const dir = action.includes('down') ? -1 : 1;
        const updated = Transfers.negotiate(item.data.contractOffer, field, dir);
        const evalRes = Transfers.evaluateCounterOffer(item.data.contractOffer, updated);
        if (evalRes.accepted) item.data.contractOffer = updated;
        alert(evalRes.reaction);
        refreshHub();
        return;
      }

      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (item.type === 'transfer_offer') action === 'accept' ? Career.acceptTransfer(item) : Career.rejectTransfer(item);
        if (item.type === 'sponsor_offer') action === 'accept' ? Career.acceptSponsor(item) : Career.rejectSponsor(item);
        if (item.type === 'call_up') action === 'accept' ? Career.acceptCallUp(item) : Career.declineCallUp(item);
        refreshHub();
        return;
      }

      const ansBtn = e.target.closest('[data-answer]');
      if (ansBtn && item.type === 'interview') {
        Career.answerInterview(item, ansBtn.dataset.answer);
        refreshHub();
        return;
      }
    }
  }

  function refreshHub(topbarOnly) {
    const state = Career.getState();
    if (!state) return;
    // Cheap full hub re-render keeps topbar (OVR, week) and badge counts in sync.
    UI.renderHub(state);
    wireHubEvents();
  }
})();
