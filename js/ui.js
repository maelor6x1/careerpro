/**
 * ui.js
 * ---------------------------------------------------------------------------
 * All DOM rendering lives here. Pure presentation — game.js wires up event
 * handlers that call into Career/Transfers and then re-render via UI.render*.
 * ---------------------------------------------------------------------------
 */

const UI = (() => {
  const root = () => document.getElementById('app');

  function crestImg(club, size = 40) {
    const c = DB.getCrest(club);
    return `<img class="crest" width="${size}" height="${size}" src="${c.remote}" onerror="this.onerror=null;this.src='${c.fallback}'" alt="${club.name}">`;
  }

  function attrBar(label, value) {
    return `<div class="attr-row">
      <span class="attr-label">${label}</span>
      <div class="attr-track"><div class="attr-fill" style="width:${value}%"></div></div>
      <span class="attr-val">${value}</span>
    </div>`;
  }

  function statChip(label, value) {
    return `<div class="chip"><span class="chip-val">${value}</span><span class="chip-label">${label}</span></div>`;
  }

  // =========================================================================
  // SCREEN: NEW GAME — player creation form
  // =========================================================================
  function renderCreatePlayer() {
    const nats = DB.NATIONALITIES.map(n => `<option value="${n}">${n}</option>`).join('');
    const poss = DB.POSITIONS.map(p => `<option value="${p}">${DB.POSITION_NAMES[p]}</option>`).join('');
    root().innerHTML = `
    <div class="screen create-screen">
      <div class="brand"><span class="brand-mark">⚽</span><h1>CAREER<span>PRO</span></h1></div>
      <p class="tagline">Construa a carreira do seu atleta, do sub-17 ao topo do futebol mundial.</p>
      <form id="createForm" class="card form-card">
        <div class="grid2">
          <label>Nome<input required name="firstName" maxlength="18" placeholder="Ex: Rafael"></label>
          <label>Sobrenome<input required name="lastName" maxlength="18" placeholder="Ex: Andrade"></label>
        </div>
        <div class="grid3">
          <label>Idade
            <select name="age"><option value="16">16 anos</option><option value="17">17 anos</option><option value="18" selected>18 anos</option></select>
          </label>
          <label>Nacionalidade<select name="nationality">${nats}</select></label>
          <label>Pé dominante<select name="foot"><option>Destro</option><option>Canhoto</option><option>Ambidestro</option></select></label>
        </div>
        <div class="grid3">
          <label>Altura (cm)<input required type="number" name="height" min="160" max="205" value="180"></label>
          <label>Peso (kg)<input required type="number" name="weight" min="55" max="100" value="74"></label>
          <label>Posição<select name="position">${poss}</select></label>
        </div>
        <button class="btn-primary" type="submit">Começar carreira</button>
      </form>
    </div>`;
  }

  // =========================================================================
  // SCREEN: OVERALL REVEAL + CLUB PROPOSALS
  // =========================================================================
  function renderClubProposals(player, proposals, leagueChoiceHandler) {
    const p = player;
    let body;
    if (proposals.needsLeagueChoice) {
      const leagues = Object.entries(DB.LEAGUES).map(([code, l]) =>
        `<button class="league-pick" data-league="${code}">${l.flag} ${l.name} <small>${l.country}</small></button>`).join('');
      body = `<p class="muted">Não há liga disponível para ${p.nationality} ainda. Escolha em qual liga você quer começar:</p>
        <div class="league-grid">${leagues}</div>`;
    } else {
      body = `<p class="muted">Três clubes acompanharam sua base e enviaram propostas:</p>
        <div class="proposal-grid">
          ${proposals.clubs.map((c, i) => `
            <div class="proposal-card" data-idx="${i}">
              ${crestImg(c, 56)}
              <h3>${c.name}</h3>
              <span class="muted small">${DB.LEAGUES[c.league].name}</span>
              <div class="proposal-meta">
                <span>⭐ Reputação ${c.reputation}</span>
                <span>🏟️ ${c.stadium}</span>
              </div>
              <button class="btn-primary btn-sm" data-choose="${i}">Assinar contrato</button>
            </div>`).join('')}
        </div>`;
    }

    root().innerHTML = `
    <div class="screen reveal-screen">
      <div class="reveal-card card">
        <span class="eyebrow">Novo talento revelado</span>
        <h2>${p.name}</h2>
        <div class="reveal-row">
          <div class="ovr-badge">${p.overall}<small>OVR</small></div>
          <div class="reveal-details">
            <div>${DB.POSITION_NAMES[p.position]} · ${p.age} anos · ${p.nationality}</div>
            <div class="muted small">Potencial estimado: ${p.potential} OVR</div>
          </div>
        </div>
      </div>
      <div class="card">${body}</div>
    </div>`;

    document.querySelectorAll('.league-pick').forEach(btn => btn.addEventListener('click', () => leagueChoiceHandler(btn.dataset.league)));
  }

  function renderClubList(clubs, onChoose) {
    root().querySelector('.card:last-child').innerHTML = `
      <p class="muted">Clubes disponíveis nesta liga:</p>
      <div class="proposal-grid">
        ${clubs.map((c, i) => `
          <div class="proposal-card">
            ${crestImg(c, 56)}
            <h3>${c.name}</h3>
            <span class="muted small">${DB.LEAGUES[c.league].name}</span>
            <div class="proposal-meta"><span>⭐ Reputação ${c.reputation}</span></div>
            <button class="btn-primary btn-sm" data-choose="${i}">Assinar contrato</button>
          </div>`).join('')}
      </div>`;
    root().querySelectorAll('[data-choose]').forEach(btn =>
      btn.addEventListener('click', () => onChoose(clubs[parseInt(btn.dataset.choose)])));
  }

  // =========================================================================
  // MAIN HUB (dashboard shell + tab switching)
  // =========================================================================
  let activeTab = 'inicio';

  function renderHub(state) {
    root().innerHTML = `
    <div class="hub">
      ${renderTopbar(state)}
      <div class="hub-body">
        <nav class="tabs">
          ${tabBtn('inicio', '🏠 Início')}${tabBtn('atleta', '🧑 Atleta')}
          ${tabBtn('elenco', '👥 Elenco')}${tabBtn('calendario', '📅 Calendário')}
          ${tabBtn('treino', '🏋️ Treino')}${tabBtn('inbox', '📨 Caixa de Entrada' + (state.inbox.length ? ` <span class="badge">${state.inbox.length}</span>` : ''))}
          ${tabBtn('imprensa', '📰 Imprensa')}
        </nav>
        <div class="tab-content" id="tabContent"></div>
      </div>
    </div>`;
    document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => { activeTab = btn.dataset.tab; renderTab(state); }));
    renderTab(state);
  }

  function tabBtn(key, label) { return `<button class="tab ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`; }

  function renderTopbar(state) {
    const p = state.player;
    return `<header class="topbar">
      <div class="topbar-club">${crestImg(state.club, 32)}<span>${state.club.name}</span></div>
      <div class="topbar-player">
        <span class="topbar-name">${p.name}</span>
        <span class="topbar-ovr">${p.overall} OVR</span>
      </div>
      <div class="topbar-meta">
        <span>Temporada ${state.season} · Semana ${state.week}</span>
        <span>${Career.formatMoney ? '' : ''}</span>
      </div>
    </header>`;
  }

  function renderTab(state) {
    const el = document.getElementById('tabContent');
    if (!el) return;
    if (activeTab === 'inicio') el.innerHTML = tplInicio(state);
    if (activeTab === 'atleta') el.innerHTML = tplAtleta(state);
    if (activeTab === 'elenco') el.innerHTML = tplElenco(state);
    if (activeTab === 'calendario') el.innerHTML = tplCalendario(state);
    if (activeTab === 'treino') el.innerHTML = tplTreino(state);
    if (activeTab === 'inbox') el.innerHTML = tplInbox(state);
    if (activeTab === 'imprensa') el.innerHTML = tplImprensa(state);
  }

  function refreshActiveTab(state) { renderTab(state); }

  // ---- Início ----
  function tplInicio(state) {
    const p = state.player;
    const next = state.calendar[state.calendarIndex];
    const role = Career.coachDecision();
    const roleLabels = { titular: '🟢 Titular', banco: '🟡 Banco', relacionado: '🟠 Relacionado', reserva: '🔴 Reserva', lesionado: '🚑 Lesionado' };
    return `
      <div class="grid-2col">
        <div class="card">
          <h3>Status do técnico</h3>
          <div class="role-pill role-${role}">${roleLabels[role]}</div>
          <div class="stat-row">
            ${statChip('Forma', Math.round(p.form))}
            ${statChip('Moral', Math.round(p.morale))}
            ${statChip('Fadiga', Math.round(100 - p.fitness))}
            ${statChip('Popularidade', Math.round(p.popularity))}
          </div>
        </div>
        <div class="card">
          <h3>Próximo compromisso</h3>
          ${next ? `<p>${next.competition} — Rodada ${next.round}</p><p class="muted">Adversário: ${next.opponent}</p>
            <button class="btn-primary" id="btnPlayMatch">Simular partida</button>`
        : `<p class="muted">Temporada concluída.</p><button class="btn-primary" id="btnEndSeason">Encerrar temporada</button>`}
        </div>
      </div>
      <div class="card">
        <h3>Últimos jogos</h3>
        <div class="matchlog">
          ${state.matchLog.slice(0, 5).map(m => `<div class="matchlog-item"><span class="rating rating-${ratingClass(m.rating)}">${m.rating.toFixed(1)}</span><span>${m.text}</span></div>`).join('') || '<p class="muted">Ainda sem partidas nesta temporada.</p>'}
        </div>
      </div>`;
  }

  function ratingClass(r) { return r >= 8 ? 'great' : r >= 6.5 ? 'good' : r >= 5 ? 'ok' : 'bad'; }

  // ---- Atleta ----
  function tplAtleta(state) {
    const p = state.player;
    const attrs = PlayerModel.ALL_ATTRS;
    return `
      <div class="grid-2col">
        <div class="card">
          <h3>${p.name}</h3>
          <div class="stat-row">
            ${statChip('OVR', p.overall)}${statChip('POT', p.potential)}${statChip('Idade', p.age)}${statChip('Nível', p.level)}
          </div>
          <div class="xp-track"><div class="xp-fill" style="width:${Math.round(p.xp / p.xpToNext * 100)}%"></div></div>
          <p class="muted small">${p.xp} / ${p.xpToNext} XP para o próximo nível</p>
          <p>Clube: ${state.club.name} · Salário semanal: ${Career.formatMoney(p.contract.wageWeekly)}</p>
          <p>Valor de mercado: ${Career.formatMoney(p.marketValue)}</p>
          ${p.injury ? `<p class="warn">🚑 ${p.injury.type} — ${p.injury.weeksLeft} semana(s) restantes</p>` : ''}
          <h4>Habilidades desbloqueadas</h4>
          <div class="skill-list">${p.skills.length ? p.skills.map(s => `<span class="pill">${s}</span>`).join('') : '<span class="muted small">Nenhuma ainda</span>'}</div>
          <h4>Troféus</h4>
          <div class="skill-list">${p.trophies.length ? p.trophies.map(s => `<span class="pill pill-gold">🏆 ${s}</span>`).join('') : '<span class="muted small">Nenhum ainda</span>'}</div>
        </div>
        <div class="card">
          <h3>Atributos</h3>
          ${attrs.map(a => attrBar(a[0].toUpperCase() + a.slice(1), p.attributes[a])).join('')}
        </div>
      </div>
      <div class="card">
        <h3>Estatísticas da temporada</h3>
        <div class="stat-row">
          ${statChip('Jogos', p.seasonStats.matches)}${statChip('Gols', p.seasonStats.goals)}
          ${statChip('Assist.', p.seasonStats.assists)}${statChip('Média', p.seasonStats.avgRating || 0)}
          ${statChip('Craque', p.seasonStats.motm)}
        </div>
      </div>`;
  }

  // ---- Elenco ----
  function tplElenco(state) {
    const rows = state.squad.slice().sort((a, b) => b.overall - a.overall).map(pl => `
      <tr class="${pl.isStarter ? 'starter' : ''}">
        <td>${pl.name}</td><td>${DB.POSITION_NAMES[pl.position]}</td><td>${pl.age}</td>
        <td><strong>${pl.overall}</strong></td><td>${Career.formatMoney(pl.marketValue)}</td>
      </tr>`).join('');
    return `<div class="card">
      <h3>Elenco do ${state.club.name}</h3>
      <table class="squad-table"><thead><tr><th>Nome</th><th>Pos.</th><th>Idade</th><th>OVR</th><th>Valor</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  }

  // ---- Calendário ----
  function tplCalendario(state) {
    const rows = state.calendar.map((f, i) => `
      <tr class="${f.played ? 'played' : ''} ${i === state.calendarIndex ? 'current' : ''}">
        <td>${f.competition}</td><td>Rodada ${f.round}${f.isCup ? ' (mata-mata)' : ''}</td>
        <td>${f.opponent}</td><td>${f.played ? '✅' : '—'}</td>
      </tr>`).join('');
    return `<div class="card"><h3>Calendário da temporada</h3>
      <table class="squad-table"><thead><tr><th>Competição</th><th>Rodada</th><th>Adversário</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  // ---- Treino ----
  function tplTreino(state) {
    const plans = [
      ['finalizacao', 'Finalização', '⚽'], ['passe', 'Passe & Visão', '🎯'], ['fisico', 'Físico', '💪'],
      ['defesa', 'Defesa', '🛡️'], ['tecnica', 'Técnica & Drible', '🌀'], ['goleiro', 'Goleiro', '🧤'],
    ];
    return `<div class="card">
      <h3>Plano de treino</h3>
      <p class="muted small">Fadiga atual: ${Math.round(100 - state.player.fitness)}%. Treinar aumenta atributos, mas também cansa o atleta.</p>
      <div class="training-grid">
        ${plans.map(([key, label, icon]) => `<button class="train-card" data-plan="${key}"><span class="train-icon">${icon}</span>${label}</button>`).join('')}
      </div>
      <div id="trainResult"></div>
    </div>`;
  }

  // ---- Inbox ----
  function tplInbox(state) {
    if (!state.inbox.length) return `<div class="card"><p class="muted">Nenhuma pendência no momento.</p></div>`;
    return state.inbox.map(item => {
      if (item.type === 'transfer_offer') return transferCard(item);
      if (item.type === 'sponsor_offer') return sponsorCard(item);
      if (item.type === 'interview') return interviewCard(item);
      if (item.type === 'call_up') return callUpCard(item);
      return '';
    }).join('');
  }

  function transferCard(item) {
    const { club, fee, contractOffer } = item.data;
    return `<div class="card inbox-card" data-id="${item.id}">
      <div class="inbox-head">${crestImg(club, 40)}<div><h3>Proposta do ${club.name}</h3><span class="muted small">Taxa de transferência: ${Career.formatMoney(fee)}</span></div></div>
      <div class="stat-row">
        ${statChip('Salário/sem', Career.formatMoney(contractOffer.wageWeekly))}
        ${statChip('Anos', contractOffer.years)}
        ${statChip('Luvas', Career.formatMoney(contractOffer.signingBonus))}
        ${statChip('Cláusula', Career.formatMoney(contractOffer.releaseClause))}
      </div>
      <div class="negotiate-row">
        <button class="btn-ghost" data-action="neg-wage-up">Pedir salário maior</button>
        <button class="btn-ghost" data-action="neg-years-down">Reduzir anos</button>
        <button class="btn-ghost" data-action="neg-clause-up">Elevar cláusula</button>
      </div>
      <div class="btn-row">
        <button class="btn-primary" data-action="accept">Aceitar</button>
        <button class="btn-secondary" data-action="reject">Recusar</button>
      </div>
    </div>`;
  }

  function sponsorCard(item) {
    const { sponsor, payment, bonusPerGoal, durationSeasons, objective } = item.data;
    return `<div class="card inbox-card" data-id="${item.id}">
      <div class="inbox-head"><div class="sponsor-badge" style="background:${sponsor.color}">${sponsor.name[0]}</div>
        <div><h3>Patrocínio ${sponsor.name}</h3><span class="muted small">${sponsor.type}</span></div></div>
      <div class="stat-row">
        ${statChip('Pagamento', Career.formatMoney(payment))}${statChip('Bônus/gol', Career.formatMoney(bonusPerGoal))}${statChip('Duração', durationSeasons + ' temp.')}
      </div>
      <p class="muted small">Objetivo: ${objective}</p>
      <div class="btn-row"><button class="btn-primary" data-action="accept">Aceitar</button><button class="btn-secondary" data-action="reject">Recusar</button></div>
    </div>`;
  }

  function interviewCard(item) {
    return `<div class="card inbox-card" data-id="${item.id}">
      <h3>Entrevista pós-jogo</h3>
      <p class="muted small">Um jornalista pergunta sobre seu momento na equipe.</p>
      <div class="btn-row wrap">
        <button class="btn-ghost" data-answer="humilde">"O mérito é do grupo."</button>
        <button class="btn-ghost" data-answer="confiante">"Sei do meu potencial."</button>
        <button class="btn-ghost" data-answer="motivacional">"Vamos em busca de mais!"</button>
        <button class="btn-ghost" data-answer="critico">"Podíamos ter feito mais."</button>
      </div>
    </div>`;
  }

  function callUpCard(item) {
    return `<div class="card inbox-card" data-id="${item.id}">
      <h3>📣 Convocação da Seleção</h3>
      <p>Você foi convocado para <strong>${item.data.competition}</strong> representando ${item.data.nationality}.</p>
      <div class="btn-row"><button class="btn-primary" data-action="accept">Aceitar convocação</button><button class="btn-secondary" data-action="reject">Recusar</button></div>
    </div>`;
  }

  // ---- Imprensa ----
  function tplImprensa(state) {
    return `<div class="card"><h3>Últimas notícias</h3>
      <div class="news-list">
        ${state.news.map(n => `<div class="news-item"><strong>${n.title}</strong><p class="muted small">${n.body}</p></div>`).join('') || '<p class="muted">Nenhuma notícia ainda.</p>'}
      </div></div>`;
  }

  // =========================================================================
  // MATCH RESULT MODAL
  // =========================================================================
  function showMatchModal(result, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const roleText = result.played ? '' : '<p class="muted">Você não entrou em campo nesta partida.</p>';
    const sim = result.sim;
    overlay.innerHTML = `<div class="modal card">
      <h2>${result.fixture.competition} — Rodada ${result.fixture.round}</h2>
      <p class="muted">vs ${result.fixture.opponent}</p>
      ${roleText}
      ${sim ? `
        <div class="rating rating-${ratingClass(sim.rating)} rating-lg">${sim.rating.toFixed(1)}</div>
        <div class="match-events">${sim.log.map(l => `<p>${l}</p>`).join('')}</div>
      ` : ''}
      <button class="btn-primary" id="closeModal">Continuar</button>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#closeModal').addEventListener('click', () => { overlay.remove(); onClose && onClose(); });
  }

  return {
    renderCreatePlayer, renderClubProposals, renderClubList, renderHub,
    refreshActiveTab, showMatchModal, getActiveTab: () => activeTab,
  };
})();
