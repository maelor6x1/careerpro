/**
 * database.js
 * ---------------------------------------------------------------------------
 * Central data layer for CareerPro. Holds static reference data: leagues,
 * clubs, national federations, sponsors, competitions, and the name pools
 * used to procedurally generate realistic squads for every club in the game.
 *
 * NOTE ON SQUAD DATA: Clubs, leagues, stadiums and countries below use real,
 * stable names. Full first-team rosters for every club in nine leagues
 * change every transfer window, so instead of hand-typing (and inevitably
 * getting wrong) hundreds of "real" player names, DB.generateSquad() builds
 * realistic squads procedurally from large real-world first/last name pools
 * per nationality. This keeps overalls, ages and squad depth consistent and
 * game-balanced, and it's trivial to swap in a real, up-to-date roster feed
 * later: replace DB.generateSquad() with a fetch/import and the rest of the
 * engine (career.js, transfers.js, events.js) doesn't need to change.
 * ---------------------------------------------------------------------------
 */

const DB = (() => {

  // ---------------------------------------------------------------------
  // CREST HELPER — tries a real crest CDN, falls back to a generated SVG
  // monogram badge if the image fails to load (offline, blocked, renamed).
  // ---------------------------------------------------------------------
  function crestUrl(club) {
    return `https://raw.githubusercontent.com/luukhopman/football-logos/master/logos/${encodeURIComponent(club.league)}/${encodeURIComponent(club.name)}.png`;
  }

  function monogramSVG(name, color1, color2) {
    const initials = name.split(' ').filter(w => w.length > 2 || w === w.toUpperCase())
      .slice(0, 2).map(w => w[0]).join('').toUpperCase() || name.slice(0, 2).toUpperCase();
    return `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${color1}"/><stop offset="1" stop-color="${color2}"/>
        </linearGradient></defs>
        <polygon points="50,4 92,26 92,70 50,96 8,70 8,26" fill="url(#g)" stroke="#0d1117" stroke-width="3"/>
        <text x="50" y="62" font-family="Arial Black, sans-serif" font-size="34" fill="#fff"
          text-anchor="middle" font-weight="900">${initials}</text>
      </svg>`)}`;
  }

  // ---------------------------------------------------------------------
  // COUNTRIES / LEAGUES
  // ---------------------------------------------------------------------
  const LEAGUES = {
    BRA: { name: 'Brasileirão Série A', country: 'Brasil', tier: 1, flag: '🇧🇷' },
    ARG: { name: 'Liga Profesional Argentina', country: 'Argentina', tier: 1, flag: '🇦🇷' },
    ENG: { name: 'Premier League', country: 'Inglaterra', tier: 1, flag: '🏴' },
    ESP: { name: 'LaLiga', country: 'Espanha', tier: 1, flag: '🇪🇸' },
    ITA: { name: 'Serie A', country: 'Itália', tier: 1, flag: '🇮🇹' },
    GER: { name: 'Bundesliga', country: 'Alemanha', tier: 1, flag: '🇩🇪' },
    FRA: { name: 'Ligue 1', country: 'França', tier: 1, flag: '🇫🇷' },
    POR: { name: 'Primeira Liga', country: 'Portugal', tier: 1, flag: '🇵🇹' },
    NED: { name: 'Eredivisie', country: 'Holanda', tier: 1, flag: '🇳🇱' },
  };

  // Brazilian state championships (played before the Brasileirão)
  const ESTADUAIS = {
    MG: 'Campeonato Mineiro', RJ: 'Campeonato Carioca', SP: 'Campeonato Paulista',
    RS: 'Campeonato Gaúcho', BA: 'Campeonato Baiano', PE: 'Campeonato Pernambucano',
    CE: 'Campeonato Cearense', PR: 'Campeonato Paranaense',
  };

  // ---------------------------------------------------------------------
  // CLUBS — real names, real stadiums, real states/countries.
  // colors used for the monogram fallback crest.
  // ---------------------------------------------------------------------
  const CLUBS = [
    // BRAZIL
    club('Cruzeiro', 'BRA', 'MG', 'Mineirão', 78, '#003399', '#001a4d'),
    club('Atlético Mineiro', 'BRA', 'MG', 'Arena MRV', 79, '#000000', '#3d0a0a'),
    club('Fortaleza', 'BRA', 'CE', 'Castelão', 74, '#1c3f94', '#c8102e'),
    club('Sport Recife', 'BRA', 'PE', 'Ilha do Retiro', 71, '#c8102e', '#000000'),
    club('Coritiba', 'BRA', 'PR', 'Couto Pereira', 70, '#00873e', '#000000'),
    club('Bahia', 'BRA', 'BA', 'Arena Fonte Nova', 73, '#1c3f94', '#c8102e'),
    club('Flamengo', 'BRA', 'RJ', 'Maracanã', 84, '#c8102e', '#000000'),
    club('Fluminense', 'BRA', 'RJ', 'Maracanã', 78, '#7a1e3c', '#046a38'),
    club('Vasco da Gama', 'BRA', 'RJ', 'São Januário', 74, '#000000', '#ffffff'),
    club('Botafogo', 'BRA', 'RJ', 'Nilton Santos', 79, '#000000', '#ffffff'),
    club('Palmeiras', 'BRA', 'SP', 'Allianz Parque', 85, '#046a38', '#ffffff'),
    club('São Paulo', 'BRA', 'SP', 'Morumbi', 79, '#c8102e', '#000000'),
    club('Corinthians', 'BRA', 'SP', 'Neo Química Arena', 78, '#000000', '#ffffff'),
    club('Santos', 'BRA', 'SP', 'Vila Belmiro', 73, '#000000', '#ffffff'),
    club('Grêmio', 'BRA', 'RS', 'Arena do Grêmio', 78, '#046a38', '#003399'),
    club('Internacional', 'BRA', 'RS', 'Beira-Rio', 78, '#c8102e', '#ffffff'),
    club('Juventude', 'BRA', 'RS', 'Alfredo Jaconi', 68, '#046a38', '#ffffff'),

    club('América Mineiro', 'BRA', 'MG', 'Independência', 68, '#00954c', '#000000'),
    club('Ceará', 'BRA', 'CE', 'Castelão', 71, '#000000', '#ffffff'),
    club('Ferroviário', 'BRA', 'CE', 'Presidente Vargas', 62, '#c8102e', '#000000'),
    club('Náutico', 'BRA', 'PE', 'Aflitos', 65, '#c8102e', '#003399'),
    club('Santa Cruz', 'BRA', 'PE', 'Arruda', 63, '#c8102e', '#000000'),
    club('Athletico Paranaense', 'BRA', 'PR', 'Ligga Arena', 76, '#c8102e', '#000000'),
    club('Paraná Clube', 'BRA', 'PR', 'Vila Capanema', 60, '#003399', '#c8102e'),
    club('Vitória', 'BRA', 'BA', 'Barradão', 68, '#c8102e', '#000000'),
    club('Jacuipense', 'BRA', 'BA', 'Estádio Justiniano Machado', 55, '#046a38', '#ffffff'),

    // ARGENTINA
    club('River Plate', 'ARG', null, 'Estadio Monumental', 84, '#e30513', '#ffffff'),
    club('Boca Juniors', 'ARG', null, 'La Bombonera', 83, '#003399', '#f9d616'),
    club('Racing Club', 'ARG', null, 'Cilindro de Avellaneda', 77, '#75aadb', '#ffffff'),
    club('Independiente', 'ARG', null, 'Libertadores de América', 74, '#c8102e', '#ffffff'),
    club('San Lorenzo', 'ARG', null, 'Pedro Bidegain', 73, '#003399', '#c8102e'),
    club('Vélez Sarsfield', 'ARG', null, 'José Amalfitani', 75, '#003399', '#ffffff'),
    club('Estudiantes de La Plata', 'ARG', null, 'Jorge Luis Hirschi', 74, '#c8102e', '#ffffff'),
    club('Talleres', 'ARG', null, 'Mario Alberto Kempes', 73, '#003399', '#ffffff'),

    // ENGLAND
    club('Manchester City', 'ENG', null, 'Etihad Stadium', 89, '#6caddf', '#1c2c5b'),
    club('Arsenal', 'ENG', null, 'Emirates Stadium', 87, '#ef0107', '#063672'),
    club('Liverpool', 'ENG', null, 'Anfield', 87, '#c8102e', '#00b2a9'),
    club('Manchester United', 'ENG', null, 'Old Trafford', 83, '#da291c', '#fbe122'),
    club('Chelsea', 'ENG', null, 'Stamford Bridge', 83, '#034694', '#ffffff'),
    club('Tottenham Hotspur', 'ENG', null, 'Tottenham Hotspur Stadium', 82, '#132257', '#ffffff'),
    club('Newcastle United', 'ENG', null, "St James' Park", 80, '#241f20', '#ffffff'),
    club('Aston Villa', 'ENG', null, 'Villa Park', 79, '#670e36', '#95bfe5'),
    club('Brighton & Hove Albion', 'ENG', null, 'Amex Stadium', 76, '#0057b8', '#ffcd00'),
    club('West Ham United', 'ENG', null, 'London Stadium', 75, '#7a263a', '#1bb1e7'),

    // SPAIN
    club('Real Madrid', 'ESP', null, 'Santiago Bernabéu', 90, '#ffffff', '#febe10'),
    club('Barcelona', 'ESP', null, 'Spotify Camp Nou', 88, '#a50044', '#004d98'),
    club('Atlético de Madrid', 'ESP', null, 'Cívitas Metropolitano', 84, '#c8102e', '#0b1642'),
    club('Real Sociedad', 'ESP', null, 'Reale Arena', 79, '#0067b1', '#ffffff'),
    club('Athletic Club', 'ESP', null, 'San Mamés', 79, '#ee2523', '#ffffff'),
    club('Real Betis', 'ESP', null, 'Benito Villamarín', 78, '#00954c', '#ffffff'),
    club('Villarreal', 'ESP', null, 'Estadio de la Cerámica', 78, '#ffe667', '#005187'),
    club('Sevilla', 'ESP', null, 'Ramón Sánchez-Pizjuán', 76, '#ffffff', '#d2001c'),

    // ITALY
    club('Inter de Milão', 'ITA', null, 'San Siro', 87, '#0068a8', '#000000'),
    club('Juventus', 'ITA', null, 'Allianz Stadium', 84, '#000000', '#ffffff'),
    club('AC Milan', 'ITA', null, 'San Siro', 83, '#fb090b', '#000000'),
    club('Napoli', 'ITA', null, 'Diego Armando Maradona', 83, '#12a0d7', '#003c71'),
    club('AS Roma', 'ITA', null, 'Stadio Olimpico', 80, '#960a3d', '#f0bc42'),
    club('Atalanta', 'ITA', null, 'Gewiss Stadium', 80, '#1e71b8', '#000000'),
    club('Lazio', 'ITA', null, 'Stadio Olimpico', 78, '#a3d5f7', '#ffffff'),
    club('Fiorentina', 'ITA', null, 'Artemio Franchi', 77, '#663399', '#ffffff'),

    // GERMANY
    club('Bayern de Munique', 'GER', null, 'Allianz Arena', 88, '#dc052d', '#0066b2'),
    club('Borussia Dortmund', 'GER', null, 'Signal Iduna Park', 83, '#fde100', '#000000'),
    club('RB Leipzig', 'GER', null, 'Red Bull Arena', 82, '#dd0741', '#ffffff'),
    club('Bayer Leverkusen', 'GER', null, 'BayArena', 82, '#e32221', '#000000'),
    club('Eintracht Frankfurt', 'GER', null, 'Deutsche Bank Park', 78, '#e1000f', '#000000'),
    club('VfB Stuttgart', 'GER', null, 'MHPArena', 78, '#ffffff', '#e32219'),
    club('Borussia Mönchengladbach', 'GER', null, 'Borussia-Park', 76, '#000000', '#ffffff'),

    // FRANCE
    club('Paris Saint-Germain', 'FRA', null, 'Parc des Princes', 87, '#004170', '#da291c'),
    club('AS Monaco', 'FRA', null, 'Stade Louis II', 80, '#c8102e', '#ffffff'),
    club('Olympique de Marselha', 'FRA', null, 'Stade Vélodrome', 79, '#2fa4de', '#ffffff'),
    club('Lille', 'FRA', null, 'Stade Pierre-Mauroy', 77, '#c8102e', '#0b1a40'),
    club('Olympique Lyonnais', 'FRA', null, 'Groupama Stadium', 77, '#c8102e', '#003399'),
    club('Lens', 'FRA', null, 'Stade Bollaert-Delelis', 76, '#ffcc00', '#c8102e'),
    club('Rennes', 'FRA', null, 'Roazhon Park', 75, '#c8102e', '#000000'),

    // PORTUGAL
    club('Benfica', 'POR', null, 'Estádio da Luz', 82, '#c8102e', '#ffffff'),
    club('FC Porto', 'POR', null, 'Estádio do Dragão', 82, '#00447c', '#ffffff'),
    club('Sporting CP', 'POR', null, 'José Alvalade', 81, '#ffffff', '#00843d'),
    club('SC Braga', 'POR', null, 'Municipal de Braga', 76, '#c8102e', '#ffffff'),
    club('Vitória de Guimarães', 'POR', null, 'D. Afonso Henriques', 73, '#ffffff', '#000000'),

    // NETHERLANDS
    club('Ajax', 'NED', null, 'Johan Cruyff Arena', 80, '#d2122e', '#ffffff'),
    club('PSV Eindhoven', 'NED', null, 'Philips Stadion', 81, '#ed1c24', '#ffffff'),
    club('Feyenoord', 'NED', null, 'De Kuip', 79, '#c8102e', '#000000'),
    club('AZ Alkmaar', 'NED', null, 'AFAS Stadion', 74, '#c8102e', '#ffffff'),
    club('FC Twente', 'NED', null, 'De Grolsch Veste', 73, '#c8102e', '#ffffff'),
  ];

  function club(name, league, state, stadium, rep, c1, c2) {
    const c = {
      id: slug(name), name, league, state, stadium, reputation: rep,
      colors: [c1, c2], budget: Math.round(rep * rep * 1200 * (0.8 + Math.random() * 0.6)),
    };
    // Coach name depends on NAME_POOLS, which is declared further down this
    // file — resolve it lazily on first access instead of at array-build time.
    Object.defineProperty(c, 'coach', {
      enumerable: true, configurable: true,
      get() { const n = randomCoachName(league); Object.defineProperty(c, 'coach', { value: n, enumerable: true }); return n; },
    });
    return c;
  }

  function slug(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-'); }

  function getCrest(clubObj) {
    return { remote: crestUrl({ name: clubObj.name, league: LEAGUES[clubObj.league].name }), fallback: monogramSVG(clubObj.name, clubObj.colors[0], clubObj.colors[1]) };
  }

  // ---------------------------------------------------------------------
  // SPONSORS — real global sportswear / tech / energy brands
  // ---------------------------------------------------------------------
  const SPONSORS = [
    { name: 'Nike', type: 'Material Esportivo', tier: 3, color: '#111111' },
    { name: 'Adidas', type: 'Material Esportivo', tier: 3, color: '#000000' },
    { name: 'Puma', type: 'Material Esportivo', tier: 2, color: '#000000' },
    { name: 'New Balance', type: 'Material Esportivo', tier: 2, color: '#c8102e' },
    { name: 'Umbro', type: 'Material Esportivo', tier: 1, color: '#0b1642' },
    { name: 'Mizuno', type: 'Material Esportivo', tier: 1, color: '#0033a0' },
    { name: 'Under Armour', type: 'Material Esportivo', tier: 2, color: '#c8102e' },
    { name: 'Red Bull', type: 'Energético', tier: 3, color: '#1b1f8a' },
    { name: 'Monster Energy', type: 'Energético', tier: 2, color: '#0a8a3c' },
    { name: 'EA Sports', type: 'Entretenimento', tier: 3, color: '#e2231a' },
    { name: 'Oakley', type: 'Acessórios', tier: 1, color: '#e2231a' },
    { name: 'HyperX', type: 'Tecnologia', tier: 1, color: '#e2231a' },
    { name: 'Samsung', type: 'Tecnologia', tier: 3, color: '#1428a0' },
    { name: 'Apple', type: 'Tecnologia', tier: 3, color: '#555555' },
    { name: 'Sony', type: 'Tecnologia', tier: 2, color: '#000000' },
  ];

  // ---------------------------------------------------------------------
  // NAME POOLS — first/last names per nationality, used to procedurally
  // build believable full names for generated players.
  // ---------------------------------------------------------------------
  const NAME_POOLS = {
    Brasil: {
      first: ['Gabriel', 'Lucas', 'Matheus', 'Bruno', 'Rafael', 'Pedro', 'Vinícius', 'Kaique', 'Thiago', 'Everton', 'Wesley', 'Anderson', 'Cauã', 'Igor', 'Yuri', 'Erick', 'Douglas', 'Ryan', 'Emerson', 'Marcelo'],
      last: ['Silva', 'Souza', 'Santos', 'Oliveira', 'Pereira', 'Costa', 'Almeida', 'Ferreira', 'Rodrigues', 'Carvalho', 'Gomes', 'Martins', 'Araújo', 'Barbosa', 'Ribeiro', 'Nascimento', 'Cardoso', 'Teixeira'],
    },
    Argentina: {
      first: ['Lautaro', 'Enzo', 'Julián', 'Nicolás', 'Franco', 'Thiago', 'Valentín', 'Agustín', 'Ezequiel', 'Máximo', 'Ignacio', 'Bautista'],
      last: ['González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Díaz', 'Pérez', 'Sánchez', 'Romero', 'Álvarez', 'Torres', 'Ruiz'],
    },
    Inglaterra: {
      first: ['Jack', 'Harry', 'Oliver', 'George', 'Charlie', 'Jacob', 'Alfie', 'Freddie', 'Archie', 'Tyler', 'Callum', 'Ethan'],
      last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Wilson', 'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Baker', 'Harris'],
    },
    Espanha: {
      first: ['Alejandro', 'Pablo', 'Álvaro', 'Marc', 'Iker', 'Hugo', 'Mario', 'Sergio', 'Adrián', 'Diego', 'Rodrigo', 'Nico'],
      last: ['García', 'Martín', 'López', 'González', 'Fernández', 'Muñoz', 'Navarro', 'Torres', 'Domínguez', 'Vázquez', 'Ramos', 'Gil'],
    },
    Itália: {
      first: ['Matteo', 'Lorenzo', 'Andrea', 'Francesco', 'Marco', 'Davide', 'Riccardo', 'Gianluca', 'Federico', 'Simone', 'Alessandro'],
      last: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo'],
    },
    Alemanha: {
      first: ['Maximilian', 'Leon', 'Finn', 'Jonas', 'Elias', 'Paul', 'Luca', 'Noah', 'Felix', 'Julian', 'Tim'],
      last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Hoffmann', 'Koch', 'Richter'],
    },
    França: {
      first: ['Hugo', 'Léo', 'Nathan', 'Enzo', 'Louis', 'Gabriel', 'Mohamed', 'Yanis', 'Rayan', 'Mathis', 'Kylian'],
      last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent'],
    },
    Portugal: {
      first: ['João', 'Rúben', 'Gonçalo', 'Diogo', 'Francisco', 'Tiago', 'Rafael', 'André', 'Bernardo', 'Pedro'],
      last: ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Costa', 'Oliveira', 'Carvalho', 'Rodrigues', 'Martins', 'Sousa'],
    },
    Holanda: {
      first: ['Sem', 'Daan', 'Levi', 'Milan', 'Luuk', 'Bram', 'Thijs', 'Ruben', 'Sven', 'Noud'],
      last: ['De Jong', 'Jansen', 'De Vries', 'Van den Berg', 'Bakker', 'Visser', 'Smit', 'Meijer', 'Mulder', 'De Boer'],
    },
    Outra: {
      first: ['Alex', 'Kevin', 'Chris', 'Daniel', 'Erik', 'Marco', 'Sam', 'Tom', 'Leo', 'Max'],
      last: ['Silva', 'Nowak', 'Kowalski', 'Andersen', 'Larsen', 'Novák', 'Horvat', 'Petrov', 'Ivanov', 'Popescu'],
    },
  };

  const NATIONALITIES = Object.keys(NAME_POOLS).filter(n => n !== 'Outra')
    .concat(['Uruguai', 'Colômbia', 'Chile', 'Estados Unidos', 'Bélgica', 'Croácia', 'Japão', 'Coreia do Sul', 'Nigéria', 'Senegal', 'Marrocos', 'México', 'Canadá', 'Outra']);

  function randomCoachName(leagueCode) {
    const nat = LEAGUES[leagueCode] ? LEAGUES[leagueCode].country : 'Outra';
    const pool = NAME_POOLS[nat] || NAME_POOLS.Outra;
    return `${pick(pool.first)} ${pick(pool.last)}`;
  }

  function randomPlayerName(nationality) {
    const pool = NAME_POOLS[nationality] || NAME_POOLS.Outra;
    return `${pick(pool.first)} ${pick(pool.last)}`;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  const POSITIONS = ['GOL', 'ZAG', 'LE', 'LD', 'VOL', 'MC', 'MEIA', 'PE', 'PD', 'ATA'];
  const POSITION_NAMES = {
    GOL: 'Goleiro', ZAG: 'Zagueiro', LE: 'Lateral Esquerdo', LD: 'Lateral Direito',
    VOL: 'Volante', MC: 'Meio-campista', MEIA: 'Meia Ofensivo',
    PE: 'Ponta Esquerda', PD: 'Ponta Direita', ATA: 'Atacante',
  };

  // Competitions per country (continental cups referenced by career.js)
  const COMPETITIONS = {
    BRA: ['Estadual', 'Brasileirão Série A', 'Copa do Brasil', 'Libertadores'],
    ARG: ['Liga Profesional', 'Copa Argentina', 'Libertadores'],
    ENG: ['Premier League', 'FA Cup', 'Champions League'],
    ESP: ['LaLiga', 'Copa del Rey', 'Champions League'],
    ITA: ['Serie A', 'Coppa Italia', 'Champions League'],
    GER: ['Bundesliga', 'DFB-Pokal', 'Champions League'],
    FRA: ['Ligue 1', 'Coupe de France', 'Champions League'],
    POR: ['Primeira Liga', 'Taça de Portugal', 'Champions League'],
    NED: ['Eredivisie', 'KNVB Beker', 'Champions League'],
  };

  const NATIONAL_COMPETITIONS = ['Eliminatórias', 'Copa América', 'Eurocopa', 'Copa do Mundo', 'Nations League', 'Amistoso Internacional'];

  function clubsByLeague(leagueCode) { return CLUBS.filter(c => c.league === leagueCode); }
  function clubsByCountry(country) {
    const code = Object.keys(LEAGUES).find(k => LEAGUES[k].country === country);
    return code ? clubsByLeague(code) : [];
  }
  function clubsByState(leagueCode, state) { return CLUBS.filter(c => c.league === leagueCode && c.state === state); }

  // ---------------------------------------------------------------------
  // ROUND-ROBIN SCHEDULE (turno / turno+returno) — classic circle method.
  // Returns an array of rounds; each round is an array of {home, away}
  // club-id pairs. Every pairing only ever involves clubs passed in, so
  // callers must pre-filter to a single league/state group.
  // ---------------------------------------------------------------------
  function roundRobinSchedule(clubIds, doubleRound) {
    let ids = clubIds.slice();
    const bye = ids.length % 2 !== 0;
    if (bye) ids.push(null); // phantom club = bye week
    const n = ids.length;
    const rounds = [];
    const fixed = ids[0];
    let rest = ids.slice(1);
    for (let r = 0; r < n - 1; r++) {
      const roundIds = [fixed, ...rest];
      const pairs = [];
      for (let i = 0; i < n / 2; i++) {
        const a = roundIds[i], b = roundIds[n - 1 - i];
        if (a !== null && b !== null) pairs.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
      }
      rounds.push(pairs);
      rest.unshift(rest.pop());
    }
    if (doubleRound) {
      const secondLeg = rounds.map(round => round.map(m => ({ home: m.away, away: m.home })));
      return rounds.concat(secondLeg);
    }
    return rounds;
  }

  // ---------------------------------------------------------------------
  // SINGLE-ELIMINATION BRACKET — pads to the next power of two with byes
  // (a bye auto-advances the seeded club). Returns { size, round1: [...] }
  // the rest of the bracket is filled in as each round is resolved.
  // ---------------------------------------------------------------------
  function knockoutBracket(clubIds) {
    const ids = clubIds.slice();
    let size = 2; while (size < ids.length) size *= 2;
    while (ids.length < size) ids.push(null); // bye slots
    const round1 = [];
    for (let i = 0; i < size / 2; i++) round1.push({ home: ids[i], away: ids[size - 1 - i] });
    return round1;
  }

  return {
    LEAGUES, ESTADUAIS, CLUBS, SPONSORS, NAME_POOLS, NATIONALITIES, POSITIONS,
    POSITION_NAMES, COMPETITIONS, NATIONAL_COMPETITIONS,
    getCrest, clubsByLeague, clubsByCountry, clubsByState, randomPlayerName, pick, slug,
    roundRobinSchedule, knockoutBracket,
  };
})();

