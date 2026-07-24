/**
 * ui.js
 * ---------------------------------------------------------------------------
 * All DOM rendering. Pure presentation — game.js drives the flow and calls
 * into Career/Transfers, then re-renders via the functions exported here.
 * ---------------------------------------------------------------------------
 */

const UI = (() => {
  const root = () => document.getElementById('app');

  function crestImg(club, size = 40) {
    if (!club) return '';
    const c = club.isNationalTeam ? DB.getFlagCrest(club.shortName) : DB.getCrest(club);
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
  // SCREEN: NEW GAME
  // =========================================================================
  function renderCreatePlayer() {
    const nats = DB.NATIONALITIES.map(n => `<option value="${n}">${n}</option>`).join('');
    const poss = DB.POSITIONS.map(p => `<option value="${p}">${DB.POSITION_NAMES[p]}</option>`).join('');
    root().innerHTML = `
    <div class="screen create-screen fade-in">
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
        <div class="proposal-grid">${proposals.clubs.map((c, i) => proposalCard(c, i)).join('')}</div>`;
    }

    root().innerHTML = `
    <div class="screen reveal-screen fade-in">
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

  function proposalCard(c, i) {
    return `<div class="proposal-card" data-idx="${i}">
      ${crestImg(c, 56)}
      <h3>${c.name}</h3>
      <span class="muted small">${DB.LEAGUES[c.league].name}</span>
      <div class="proposal-meta"><span>⭐ Reputação ${c.reputation}</span><span>🏟️ ${c.stadium}</span></div>
      <button class="btn-primary btn-sm" data-choose="${i}">Assinar contrato</button>
    </div>`;
  }

  function renderClubList(clubs, onChoose) {
    root().querySelector('.card:last-child').innerHTML = `
      <p class="muted">Clubes disponíveis nesta liga:</p>
      <div class="proposal-grid">${clubs.map((c, i) => proposalCard(c, i)).join('')}</div>`;
    root().querySelectorAll('[data-choose]').forEach(btn =>
      btn.addEventListener('click', () => onChoose(clubs[parseInt(btn.dataset.choose)])));
  }

  // =========================================================================
  // MAIN HUB
  // =========================================================================
  let activeTab = 'inicio';

  function renderHub(state) {
    root().innerHTML = `
    <div class="hub">
      ${renderTopbar(state)}
      <div class="hub-body">
        <nav class="tabs">
          ${tabBtn('inicio', '🏠 Início')}${tabBtn('atleta', '🧑 Atleta')}
          ${tabBtn('elenco', '👥 Elenco')}${tabBtn('competicoes', '🏆 Competições')}
          ${tabBtn('premios', '🥇 Prêmios')}
          ${tabBtn('treino', '🏋️ Treino')}${tabBtn('imprensa', '📰 Imprensa')}
        </nav>
        <div class="tab-content fade-in" id="tabContent"></div>
      </div>
    </div>`;
    document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => { activeTab = btn.dataset.tab; renderTab(state); }));
    renderTab(state);
  }

  function tabBtn(key, label) { return `<button class="tab ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`; }

  function renderTopbar(state) {
    const p = state.player;
    const [c1] = state.club.colors || ['#111', '#222'];
    return `<header class="topbar" style="--club-accent:${c1}">
      <div class="topbar-club">${crestImg(state.club, 32)}<span>${state.club.name}</span></div>
      <div class="topbar-player"><span class="topbar-name">${p.name}</span><span class="topbar-ovr">${p.overall} OVR</span></div>
      <div class="topbar-meta"><span>${state.year} · Temporada ${state.season}</span></div>
    </header>`;
  }

  function renderTab(state) {
    const el = document.getElementById('tabContent');
    if (!el) return;
    el.classList.remove('fade-in'); void el.offsetWidth; el.classList.add('fade-in');
    if (activeTab === 'inicio') el.innerHTML = tplInicio(state);
    if (activeTab === 'atleta') el.innerHTML = tplAtleta(state);
    if (activeTab === 'elenco') el.innerHTML = tplElenco(state);
    if (activeTab === 'competicoes') el.innerHTML = tplCompeticoes(state);
    if (activeTab === 'premios') el.innerHTML = tplPremios(state);
    if (activeTab === 'treino') el.innerHTML = tplTreino(state);
    if (activeTab === 'imprensa') el.innerHTML = tplImprensa(state);
  }

  function refreshActiveTab(state) { renderTab(state); }

  // ---- Início ----
  function tplInicio(state) {
    const p = state.player;
    const role = Career.coachDecision();
    const roleLabels = { titular: '🟢 Titular', banco: '🟡 Banco', relacionado: '🟠 Relacionado', reserva: '🔴 Reserva', lesionado: '🚑 Lesionado' };
    const phase = state.competitions.phase;
    const phaseLabels = { estadual: state.competitions.estadual ? state.competitions.estadual.name : '', liga: state.competitions.liga.name, copa: state.competitions.copa.name, offseason: 'Fim de temporada' };
    return `
      <div class="grid-2col">
        <div class="card">
          <h3>Status do técnico</h3>
          <div class="role-pill role-${role}">${roleLabels[role]}</div>
          <div class="stat-row">
            ${statChip('Forma', Math.round(p.form))}${statChip('Moral', Math.round(p.morale))}
            ${statChip('Fadiga', Math.round(100 - p.fitness))}${statChip('Popularidade', Math.round(p.popularity))}
          </div>
          <p class="muted small">🏋️ ${p.trainingTokens || 0} sessão(ões) de treino disponíveis esta semana</p>
        </div>
        <div class="card">
          <h3>Próxima rodada</h3>
          <p class="muted small">Competição atual: ${phaseLabels[phase]}</p>
          ${phase === 'offseason'
        ? `<p class="muted">Todas as competições da temporada terminaram.</p><button class="btn-primary" id="btnEndSeason">Encerrar temporada</button>`
        : `<button class="btn-primary" id="btnPlayRound">▶ Jogar rodada</button>`}
        </div>
      </div>
      <div class="card">
        <h3>Últimos jogos</h3>
        <div class="matchlog">
          ${state.matchLog.slice(0, 6).map(m => `<div class="matchlog-item"><span class="rating rating-${ratingClass(m.rating)}">${m.rating.toFixed(1)}</span><span>${m.text}</span></div>`).join('') || '<p class="muted">Ainda sem partidas nesta temporada.</p>'}
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
          <div class="stat-row">${statChip('OVR', p.overall)}${statChip('POT', p.potential)}${statChip('Idade', p.age)}${statChip('Nível', p.level)}</div>
          <div class="xp-track"><div class="xp-fill" style="width:${Math.round(p.xp / p.xpToNext * 100)}%"></div></div>
          <p class="muted small">${p.xp} / ${p.xpToNext} XP para o próximo nível</p>
          <p>Clube: ${state.club.name} · Salário semanal: ${Career.formatMoney(p.contract.wageWeekly)}</p>
          <p class="muted small">Contrato até ${p.contract.startYear + p.contract.years} (${Transfers.contractYearsLeft(p.contract, state.year)} ano(s) restante(s))</p>
          <p>Valor de mercado: ${Career.formatMoney(p.marketValue)}</p>
          ${p.sponsor ? `<p class="muted small">💼 Patrocínio ativo: ${p.sponsor.sponsor.name} até ${p.sponsor.startYear + p.sponsor.durationSeasons}</p>` : ''}
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
      <div class="table-scroll"><table class="squad-table"><thead><tr><th>Nome</th><th>Pos.</th><th>Idade</th><th>OVR</th><th>Valor</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    </div>`;
  }

  // ---- Competições (tabela + chaveamento) ----
  function tplCompeticoes(state) {
    const blocks = [];
    if (state.competitions.estadual) blocks.push(competitionBlock(state, 'estadual', state.competitions.estadual));
    if (state.competitions.liga) blocks.push(competitionBlock(state, 'liga', state.competitions.liga));
    if (state.competitions.copa) blocks.push(competitionBlock(state, 'copa', state.competitions.copa));
    else blocks.push(`<div class="card"><h3>${state.competitions._argCupName || 'Copa'}</h3><p class="muted">O chaveamento será definido quando as duas zonas da fase de grupos terminarem.</p></div>`);
    if (state.competitions.continental) blocks.push(competitionBlock(state, 'continental', state.competitions.continental));
    return blocks.join('');
  }

  // ---- Prêmios (Bola de Ouro / Chuteira de Ouro / Luva de Ouro) ----
  function tplPremios(state) {
    const races = Career.getAwardRaces();
    const goldenBoot = races.chuteiraDeOuro.map((r, i) => `
      <tr class="${r.isCareer ? 'current' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${r.club ? r.club.name : '—'}</td><td><strong>${r.goals}</strong></td></tr>`).join('');
    const ballonDor = races.bolaDeOuro.map((r, i) => `
      <tr class="${r.isCareer ? 'current' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${r.club ? r.club.name : '—'}</td><td><strong>${Math.round(r.score)}</strong></td></tr>`).join('');
    const glove = races.luvaDeOuro ? races.luvaDeOuro.map((r, i) => `
      <tr class="${r.isCareer ? 'current' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${r.club ? r.club.name : '—'}</td><td><strong>${r.conceded}</strong></td></tr>`).join('') : null;
    return `
      <div class="card"><h3>🥇 Bola de Ouro</h3><p class="muted small">Estimativa da imprensa com base em desempenho da temporada.</p>
        <div class="table-scroll"><table class="standings-table"><thead><tr><th>#</th><th>Jogador</th><th>Clube</th><th>Pontos</th></tr></thead><tbody>${ballonDor}</tbody></table></div>
      </div>
      <div class="card"><h3>👟 Chuteira de Ouro</h3><p class="muted small">Artilharia estimada da liga.</p>
        <div class="table-scroll"><table class="standings-table"><thead><tr><th>#</th><th>Jogador</th><th>Clube</th><th>Gols</th></tr></thead><tbody>${goldenBoot}</tbody></table></div>
      </div>
      ${glove ? `<div class="card"><h3>🧤 Luva de Ouro</h3><p class="muted small">Menos gols sofridos entre os goleiros observados.</p>
        <div class="table-scroll"><table class="standings-table"><thead><tr><th>#</th><th>Goleiro</th><th>Clube</th><th>Gols sofridos</th></tr></thead><tbody>${glove}</tbody></table></div>
      </div>` : ''}`;
  }

  function competitionBlock(state, key, phase) {
    const activeBadge = state.competitions.phase === key ? '<span class="pill pill-live">EM ANDAMENTO</span>' : (phase.champion ? '<span class="pill pill-gold">FINALIZADA</span>' : '');
    if (phase.type === 'liga') {
      const standings = Career.getStandings(key);
      const rows = standings.map((s, i) => `
        <tr class="${s.clubId === state.club.id ? 'current' : ''}">
          <td>${i + 1}</td><td class="team-cell">${crestImg(s.club, 20)} ${s.club.name}</td>
          <td>${s.pts}</td><td>${s.pj}</td><td>${s.v}</td><td>${s.e}</td><td>${s.d}</td><td>${s.gp}</td><td>${s.gc}</td><td>${s.sg}</td>
        </tr>`).join('');
      return `<div class="card">
        <h3>${phase.name} ${activeBadge}</h3>
        <div class="table-scroll"><table class="standings-table">
          <thead><tr><th>#</th><th>Clube</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
    }
    const roundNames = ['Rodada 1', 'Oitavas', 'Quartas', 'Semifinal', 'Final'];
    const roundsHtml = phase.rounds.map((round, ri) => {
      const label = roundNames[roundNames.length - (phase.rounds.length - ri)] || `Rodada ${ri + 1}`;
      const matches = round.map(pair => {
        const home = pair.home ? DB.CLUBS.find(c => c.id === pair.home) : null;
        const away = pair.away ? DB.CLUBS.find(c => c.id === pair.away) : null;
        const involvesPlayer = pair.home === state.club.id || pair.away === state.club.id;
        return `<div class="bracket-match ${involvesPlayer ? 'current' : ''}">
          <span>${home ? home.name : 'BYE'}</span><span class="muted small">vs</span><span>${away ? away.name : 'BYE'}</span>
        </div>`;
      }).join('');
      return `<div class="bracket-round"><h4>${label}</h4>${matches}</div>`;
    }).join('');
    return `<div class="card">
      <h3>${phase.name} ${activeBadge}</h3>
      <div class="bracket-scroll">${roundsHtml}</div>
    </div>`;
  }

  // ---- Treino ----
  function tplTreino(state) {
    const plans = [
      ['finalizacao', 'Finalização', '⚽'], ['passe', 'Passe & Visão', '🎯'], ['fisico', 'Físico', '💪'],
      ['defesa', 'Defesa', '🛡️'], ['tecnica', 'Técnica & Drible', '🌀'], ['goleiro', 'Goleiro', '🧤'],
    ];
    const tokens = state.player.trainingTokens || 0;
    return `<div class="card">
      <h3>Plano de treino</h3>
      <p class="muted small">${tokens} sessão(ões) disponíveis · Fadiga atual: ${Math.round(100 - state.player.fitness)}%</p>
      ${tokens <= 0 ? '<p class="warn small">Sem sessões esta semana — jogue a próxima rodada para liberar mais treinos, como no calendário real de um clube.</p>' : ''}
      <div class="training-grid">
        ${plans.map(([key, label, icon]) => `<button class="train-card" data-plan="${key}" ${tokens <= 0 ? 'disabled' : ''}><span class="train-icon">${icon}</span>${label}</button>`).join('')}
      </div>
      <div id="trainResult"></div>
    </div>`;
  }

  // ---- Decision popups (transfer offers, sponsorships, interviews, call-ups) ----
  function popupCardHTML(item) {
    if (item.type === 'transfer_offer') return transferCard(item);
    if (item.type === 'sponsor_offer') return sponsorCard(item);
    if (item.type === 'interview') return interviewCard(item);
    if (item.type === 'call_up') return callUpCard(item);
    return '';
  }

  function showDecisionPopup(item) {
    const ov = ensureOverlay();
    ov.innerHTML = `<div class="modal">${popupCardHTML(item)}</div>`;
    return ov;
  }

  function transferCard(item) {
    const { club, fee, contractOffer } = item.data;
    return `<div class="card inbox-card" data-id="${item.id}">
      <div class="inbox-head">${crestImg(club, 40)}<div><h3>Proposta do ${club.name}</h3><span class="muted small">Taxa de transferência: ${Career.formatMoney(fee)}</span></div></div>
      <div class="stat-row">
        ${statChip('Salário/sem', Career.formatMoney(contractOffer.wageWeekly))}${statChip('Anos', contractOffer.years)}
        ${statChip('Luvas', Career.formatMoney(contractOffer.signingBonus))}${statChip('Cláusula', Career.formatMoney(contractOffer.releaseClause))}
      </div>
      <div class="negotiate-row">
        <button class="btn-ghost" data-action="neg-wage-up">Pedir salário maior</button>
        <button class="btn-ghost" data-action="neg-years-down">Reduzir anos</button>
        <button class="btn-ghost" data-action="neg-clause-up">Elevar cláusula</button>
      </div>
      <div class="btn-row"><button class="btn-primary" data-action="accept">Aceitar</button><button class="btn-secondary" data-action="reject">Recusar</button></div>
    </div>`;
  }

  function sponsorCard(item) {
    const { sponsor, payment, bonusPerGoal, durationSeasons, objective } = item.data;
    return `<div class="card inbox-card" data-id="${item.id}">
      <div class="inbox-head"><div class="sponsor-badge" style="background:${sponsor.color}">${sponsor.name[0]}</div>
        <div><h3>Patrocínio ${sponsor.name}</h3><span class="muted small">${sponsor.type}</span></div></div>
      <div class="stat-row">${statChip('Pagamento', Career.formatMoney(payment))}${statChip('Bônus/gol', Career.formatMoney(bonusPerGoal))}${statChip('Duração', durationSeasons + ' temp.')}</div>
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
      <div class="news-list">${state.news.map(n => `<div class="news-item"><strong>${n.title}</strong><p class="muted small">${n.body}</p></div>`).join('') || '<p class="muted">Nenhuma notícia ainda.</p>'}</div></div>`;
  }

  // =========================================================================
  // MATCH CENTER — interactive step-by-step overlay
  // =========================================================================
  let overlayEl = null;

  function ensureOverlay() {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.className = 'modal-overlay';
      document.body.appendChild(overlayEl);
    }
    return overlayEl;
  }
  function closeOverlay() { if (overlayEl) { overlayEl.remove(); overlayEl = null; } }

  // -----------------------------------------------------------------------
  // LIVE MATCH SCREEN — persistent scoreboard + clock + auto-scrolling
  // commentary ticker, pausing only when the player needs to make a
  // decision. matchInfo needs: homeTeamObj, awayTeamObj, competition,
  // isHome (whether the player's side is "home" for score orientation).
  // -----------------------------------------------------------------------
  function renderLiveMatch(matchInfo) {
    const ov = ensureOverlay();
    ov.innerHTML = `<div class="modal live-match-modal">
      <div class="live-header">
        <div class="live-team">${crestImg(matchInfo.homeTeamObj, 48)}<span>${matchInfo.homeTeamObj.name}</span></div>
        <div class="live-center">
          <div class="live-competition">${matchInfo.competition}</div>
          <div class="live-score" id="liveScore">0 - 0</div>
          <div class="live-clock" id="liveClock">0'</div>
        </div>
        <div class="live-team">${crestImg(matchInfo.awayTeamObj, 48)}<span>${matchInfo.awayTeamObj.name}</span></div>
      </div>
      <div class="live-ticker" id="liveTicker"></div>
      <div class="live-decision" id="liveDecision"></div>
      <button class="btn-ghost btn-sm live-skip" id="liveSkipBtn">⏭ Pular para o próximo lance</button>
    </div>`;
    return ov;
  }

  function pushLiveTicker(text, minute, highlight) {
    const el = document.getElementById('liveTicker');
    if (!el) return;
    const line = document.createElement('p');
    line.className = 'ticker-line' + (highlight ? ' ticker-highlight' : '');
    line.innerHTML = `<span class="ticker-min">${minute}'</span> ${text}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  function updateLiveScore(score, isHome) {
    const el = document.getElementById('liveScore');
    if (!el) return;
    const homeGoals = isHome ? score.for : score.against;
    const awayGoals = isHome ? score.against : score.for;
    el.textContent = `${homeGoals} - ${awayGoals}`;
  }

  function updateLiveClock(minute) {
    const el = document.getElementById('liveClock');
    if (el) el.textContent = (minute >= 90 ? '90+' : minute) + "'";
  }

  function showLiveDecision(beat) {
    const el = document.getElementById('liveDecision');
    if (!el) return null;
    el.innerHTML = `<div class="decision-box pulse">
      <p class="decision-prompt">${beat.prompt}</p>
      <div class="decision-options">${beat.options.map(o => `<button class="btn-decision" data-opt="${o.key}">${o.label}</button>`).join('')}</div>
    </div>`;
    return el;
  }
  function clearLiveDecision() {
    const el = document.getElementById('liveDecision');
    if (el) el.innerHTML = '';
  }

  function renderRoundSummary(summary, onClose) {
    const ov = ensureOverlay();
    const scoreBlock = summary.played ? `
      <div class="final-score">
        <span>${summary.homeTeam}</span>
        <span class="score-num">${summary.homeGoals} — ${summary.awayGoals}</span>
        <span>${summary.awayTeam}</span>
      </div>
      <div class="rating rating-${ratingClass(summary.rating)} rating-lg">${summary.rating.toFixed(1)}</div>
      <div class="stat-row" style="justify-content:center">
        ${statChip('Seus gols', summary.playerGoals)}${statChip('Suas assist.', summary.playerAssists)}
      </div>
      ${summary.eliminated ? '<p class="warn">Eliminado na competição.</p>' : ''}
      ${summary.advanced ? '<p class="success">Classificado para a próxima fase!</p>' : ''}
    ` : `<p class="muted">${summary.bye ? 'Sua equipe folgou nesta rodada.' : 'Você não foi relacionado para este jogo.'}</p>`;

    const others = (summary.otherResults || []).slice(0, 6).map(r => {
      const home = r.home || (r.pair ? nameOf(r.pair.home) : '');
      const away = r.away || (r.pair ? nameOf(r.pair.away) : '');
      if (r.homeGoals === undefined) return '';
      return `<div class="other-result"><span>${home}</span><span>${r.homeGoals}-${r.awayGoals}</span><span>${away}</span></div>`;
    }).join('');

    ov.innerHTML = `<div class="modal card match-modal">
      <h2>${summary.competition}</h2>
      ${scoreBlock}
      ${summary.phaseOver ? '<p class="pill pill-gold">Fase encerrada!</p>' : ''}
      ${others ? `<h4>Outros resultados da rodada</h4><div class="other-results">${others}</div>` : ''}
      <button class="btn-primary" id="closeRoundBtn">Continuar</button>
    </div>`;
    ov.querySelector('#closeRoundBtn').addEventListener('click', () => { closeOverlay(); onClose && onClose(); });
  }

  function nameOf(clubId) { const c = DB.CLUBS.find(x => x.id === clubId); return c ? c.name : '—'; }

  return {
    renderCreatePlayer, renderClubProposals, renderClubList, renderHub, refreshActiveTab,
    renderLiveMatch, pushLiveTicker, updateLiveScore, updateLiveClock, showLiveDecision, clearLiveDecision,
    renderRoundSummary, showDecisionPopup, closeOverlay,
    getActiveTab: () => activeTab,
  };
})();
