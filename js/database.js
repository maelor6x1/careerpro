/**
 * database.js
 * ---------------------------------------------------------------------------
 * Central data layer for CareerPro. Clubs, leagues and formats below reflect
 * the real 2026 season as researched (Brasileirão Série A 2026, Premier
 * League/LaLiga/Serie A/Bundesliga/Ligue 1/Primeira Liga/Eredivisie 2026-27,
 * Liga Profesional Argentina 2026). Since rosters change every window, this
 * is a snapshot, not a live feed — if it goes stale, only the club lists
 * below need updating, nothing else in the engine depends on specific names.
 *
 * Player rosters for CPU clubs are still procedurally generated (see
 * player.js) rather than hand-typed real squads — full accurate rosters for
 * ~230 clubs across 9 leagues, kept current, isn't something this project
 * can reliably guarantee, so it focuses real-world accuracy on the clubs,
 * leagues and formats instead.
 * ---------------------------------------------------------------------------
 */

const DB = (() => {

  // ---------------------------------------------------------------------
  // CREST HELPER — tries a real crest from an open badge repository, falls
  // back to a generated SVG monogram badge if the image 404s (renamed club,
  // repo path mismatch, offline, etc). The fallback always renders, so a
  // broken image is never shown to the person.
  // ---------------------------------------------------------------------
  function crestUrl(club) {
    const league = CREST_LEAGUE_FOLDER[club.league] || club.league;
    return `https://raw.githubusercontent.com/luukhopman/football-logos/master/logos/${encodeURIComponent(league)}/${encodeURIComponent(club.name)}.png`;
  }

  const CREST_LEAGUE_FOLDER = {
    ENG: 'England - Premier League', ESP: 'Spain - LaLiga', ITA: 'Italy - Serie A',
    GER: 'Germany - Bundesliga', FRA: 'France - Ligue 1', POR: 'Portugal - Primeira Liga',
    NED: 'Netherlands - Eredivisie',
  };

  function monogramSVG(name, color1, color2) {
    const initials = name.split(' ').filter(w => w.length > 2 || w === w.toUpperCase())
      .slice(0, 2).map(w => w[0]).join('').toUpperCase() || name.slice(0, 2).toUpperCase();
    return `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${color1}"/><stop offset="1" stop-color="${color2}"/>
        </linearGradient></defs>
        <polygon points="50,4 92,26 92,70 50,96 8,70 8,26" fill="url(#g)" stroke="#0a0a0a" stroke-width="3"/>
        <text x="50" y="62" font-family="Arial Black, sans-serif" font-size="34" fill="#fff"
          text-anchor="middle" font-weight="900">${initials}</text>
      </svg>`)}`;
  }

  // ---------------------------------------------------------------------
  // LEAGUES — real formats. `format`: 'double' = home+away round robin,
  // 'zones' = Argentina's split-zone + playoff format.
  // ---------------------------------------------------------------------
  const LEAGUES = {
    BRA: { name: 'Brasileirão Série A', country: 'Brasil', tier: 1, flag: '🇧🇷', format: 'double' },
    ARG: { name: 'Liga Profesional', country: 'Argentina', tier: 1, flag: '🇦🇷', format: 'zones' },
    ENG: { name: 'Premier League', country: 'Inglaterra', tier: 1, flag: '🏴', format: 'double' },
    ESP: { name: 'LaLiga', country: 'Espanha', tier: 1, flag: '🇪🇸', format: 'double' },
    ITA: { name: 'Serie A', country: 'Itália', tier: 1, flag: '🇮🇹', format: 'double' },
    GER: { name: 'Bundesliga', country: 'Alemanha', tier: 1, flag: '🇩🇪', format: 'double' },
    FRA: { name: 'Ligue 1', country: 'França', tier: 1, flag: '🇫🇷', format: 'double' },
    POR: { name: 'Primeira Liga', country: 'Portugal', tier: 1, flag: '🇵🇹', format: 'double' },
    NED: { name: 'Eredivisie', country: 'Holanda', tier: 1, flag: '🇳🇱', format: 'double' },
  };

  // Brazilian state championships (played before the Brasileirão)
  const ESTADUAIS = {
    MG: 'Campeonato Mineiro', RJ: 'Campeonato Carioca', SP: 'Campeonato Paulista',
    RS: 'Campeonato Gaúcho', BA: 'Campeonato Baiano', PE: 'Campeonato Pernambucano',
    CE: 'Campeonato Cearense', PR: 'Campeonato Paranaense', SC: 'Campeonato Catarinense', PA: 'Campeonato Paraense',
  };

  // Real cup competitions per league (knockout, seeded from the league's own clubs)
  const CUPS = {
    BRA: 'Copa do Brasil', ARG: 'Copa Argentina', ENG: 'FA Cup', ESP: 'Copa del Rey',
    ITA: 'Coppa Italia', GER: 'DFB-Pokal', FRA: 'Coupe de France', POR: 'Taça de Portugal', NED: 'KNVB Beker',
  };

  function club(name, league, opts) {
    opts = opts || {};
    const c = {
      id: slug(name), name, league, state: opts.state || null, zone: opts.zone || null,
      stadium: opts.stadium || `Estádio ${name}`, reputation: opts.rep || 65,
      colors: opts.colors || ['#1c1c1c', '#3a3a3a'],
      budget: Math.round((opts.rep || 65) * (opts.rep || 65) * 1200 * (0.8 + Math.random() * 0.6)),
    };
    Object.defineProperty(c, 'coach', {
      enumerable: true, configurable: true,
      get() { const n = randomCoachName(league); Object.defineProperty(c, 'coach', { value: n, enumerable: true }); return n; },
    });
    return c;
  }

  function slug(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-'); }

  // ---------------------------------------------------------------------
  // CLUBS — real 2026-season top-flight participants for each league.
  // ---------------------------------------------------------------------
  const CLUBS = [
    // ===================== BRASIL — Brasileirão Série A 2026 (20 clubes) =====================
    club('Athletico Paranaense', 'BRA', { state: 'PR', stadium: 'Arena da Baixada', rep: 74, colors: ['#c8102e', '#000000'] }),
    club('Atlético Mineiro', 'BRA', { state: 'MG', stadium: 'Arena MRV', rep: 79, colors: ['#000000', '#3d0a0a'] }),
    club('Bahia', 'BRA', { state: 'BA', stadium: 'Arena Fonte Nova', rep: 75, colors: ['#1c3f94', '#c8102e'] }),
    club('Botafogo', 'BRA', { state: 'RJ', stadium: 'Nilton Santos', rep: 80, colors: ['#000000', '#ffffff'] }),
    club('Chapecoense', 'BRA', { state: 'SC', stadium: 'Arena Condá', rep: 65, colors: ['#046a38', '#ffffff'] }),
    club('Corinthians', 'BRA', { state: 'SP', stadium: 'Neo Química Arena', rep: 78, colors: ['#000000', '#ffffff'] }),
    club('Coritiba', 'BRA', { state: 'PR', stadium: 'Couto Pereira', rep: 68, colors: ['#00873e', '#000000'] }),
    club('Cruzeiro', 'BRA', { state: 'MG', stadium: 'Mineirão', rep: 78, colors: ['#003399', '#001a4d'] }),
    club('Flamengo', 'BRA', { state: 'RJ', stadium: 'Maracanã', rep: 86, colors: ['#c8102e', '#000000'] }),
    club('Fluminense', 'BRA', { state: 'RJ', stadium: 'Maracanã', rep: 78, colors: ['#7a1e3c', '#046a38'] }),
    club('Grêmio', 'BRA', { state: 'RS', stadium: 'Arena do Grêmio', rep: 78, colors: ['#046a38', '#003399'] }),
    club('Internacional', 'BRA', { state: 'RS', stadium: 'Beira-Rio', rep: 78, colors: ['#c8102e', '#ffffff'] }),
    club('Mirassol', 'BRA', { state: 'SP', stadium: 'Campos Maia', rep: 70, colors: ['#fdd000', '#046a38'] }),
    club('Palmeiras', 'BRA', { state: 'SP', stadium: 'Allianz Parque', rep: 86, colors: ['#046a38', '#ffffff'] }),
    club('Red Bull Bragantino', 'BRA', { state: 'SP', stadium: 'Cícero de Souza Marques', rep: 74, colors: ['#ffffff', '#c8102e'] }),
    club('Remo', 'BRA', { state: 'PA', stadium: 'Baenão', rep: 64, colors: ['#003399', '#c8102e'] }),
    club('Santos', 'BRA', { state: 'SP', stadium: 'Vila Belmiro', rep: 74, colors: ['#000000', '#ffffff'] }),
    club('São Paulo', 'BRA', { state: 'SP', stadium: 'MorumBIS', rep: 79, colors: ['#c8102e', '#000000'] }),
    club('Vasco da Gama', 'BRA', { state: 'RJ', stadium: 'São Januário', rep: 73, colors: ['#000000', '#ffffff'] }),
    club('Vitória', 'BRA', { state: 'BA', stadium: 'Barradão', rep: 68, colors: ['#c8102e', '#000000'] }),

    // ===================== ARGENTINA — Liga Profesional 2026 (30 clubes, 2 zonas) =====================
    club('River Plate', 'ARG', { zone: 'A', stadium: 'Estadio Monumental', rep: 85, colors: ['#e30513', '#ffffff'] }),
    club('Racing Club', 'ARG', { zone: 'A', stadium: 'Cilindro de Avellaneda', rep: 78, colors: ['#75aadb', '#ffffff'] }),
    club('San Lorenzo', 'ARG', { zone: 'A', stadium: 'Pedro Bidegain', rep: 73, colors: ['#003399', '#c8102e'] }),
    club('Vélez Sarsfield', 'ARG', { zone: 'A', stadium: 'José Amalfitani', rep: 75, colors: ['#003399', '#ffffff'] }),
    club('Talleres', 'ARG', { zone: 'A', stadium: 'Mario Alberto Kempes', rep: 74, colors: ['#003399', '#ffffff'] }),
    club('Lanús', 'ARG', { zone: 'A', stadium: 'Ciudad de Lanús', rep: 71, colors: ['#a3021a', '#8a1538'] }),
    club('Banfield', 'ARG', { zone: 'A', stadium: 'Florencio Sola', rep: 66, colors: ['#046a38', '#ffffff'] }),
    club('Tigre', 'ARG', { zone: 'A', stadium: 'José Dellagiovanna', rep: 65, colors: ['#003399', '#ffffff'] }),
    club('Instituto', 'ARG', { zone: 'A', stadium: 'Juan Domingo Perón', rep: 63, colors: ['#c8102e', '#ffffff'] }),
    club('Sarmiento', 'ARG', { zone: 'A', stadium: 'Eva Perón', rep: 61, colors: ['#046a38', '#ffffff'] }),
    club('Central Córdoba', 'ARG', { zone: 'A', stadium: 'Alfredo Terrera', rep: 62, colors: ['#000000', '#ffffff'] }),
    club('Unión', 'ARG', { zone: 'A', stadium: '15 de Abril', rep: 64, colors: ['#c8102e', '#ffffff'] }),
    club('Belgrano', 'ARG', { zone: 'A', stadium: 'Julio César Villagra', rep: 65, colors: ['#75aadb', '#ffffff'] }),
    club('Atlético Tucumán', 'ARG', { zone: 'A', stadium: 'Monumental José Fierro', rep: 63, colors: ['#75aadb', '#ffffff'] }),
    club('Gimnasia de Mendoza', 'ARG', { zone: 'A', stadium: 'Víctor Antonio Legrotaglie', rep: 56, colors: ['#ffffff', '#003399'] }),

    club('Boca Juniors', 'ARG', { zone: 'B', stadium: 'La Bombonera', rep: 84, colors: ['#003399', '#f9d616'] }),
    club('Independiente', 'ARG', { zone: 'B', stadium: 'Libertadores de América', rep: 74, colors: ['#c8102e', '#ffffff'] }),
    club('Estudiantes de La Plata', 'ARG', { zone: 'B', stadium: 'Jorge Luis Hirschi', rep: 75, colors: ['#c8102e', '#ffffff'] }),
    club('Newell\'s Old Boys', 'ARG', { zone: 'B', stadium: 'Marcelo Bielsa', rep: 70, colors: ['#c8102e', '#000000'] }),
    club('Rosario Central', 'ARG', { zone: 'B', stadium: 'Gigante de Arroyito', rep: 71, colors: ['#f4d03f', '#003399'] }),
    club('Argentinos Juniors', 'ARG', { zone: 'B', stadium: 'Diego Armando Maradona', rep: 68, colors: ['#c8102e', '#ffffff'] }),
    club('Huracán', 'ARG', { zone: 'B', stadium: 'Tomás Adolfo Ducó', rep: 66, colors: ['#ffffff', '#c8102e'] }),
    club('Platense', 'ARG', { zone: 'B', stadium: 'Ciudad de Vicente López', rep: 67, colors: ['#003399', '#c8102e'] }),
    club('Barracas Central', 'ARG', { zone: 'B', stadium: 'Claudio Chiqui Tapia', rep: 60, colors: ['#c8102e', '#000000'] }),
    club('Defensa y Justicia', 'ARG', { zone: 'B', stadium: 'Norberto Tomaghello', rep: 65, colors: ['#046a38', '#c8102e'] }),
    club('Independiente Rivadavia', 'ARG', { zone: 'B', stadium: 'Bautista Gargantini', rep: 62, colors: ['#c8102e', '#ffffff'] }),
    club('Deportivo Riestra', 'ARG', { zone: 'B', stadium: 'Guillermo Laza', rep: 58, colors: ['#000000', '#ffffff'] }),
    club('Gimnasia La Plata', 'ARG', { zone: 'B', stadium: 'Juan Carmelo Zerillo', rep: 62, colors: ['#003399', '#ffffff'] }),
    club('Colón', 'ARG', { zone: 'B', stadium: 'Brigadier General Estanislao López', rep: 63, colors: ['#c8102e', '#000000'] }),
    club('Estudiantes de Río Cuarto', 'ARG', { zone: 'B', stadium: 'Country Club de Río Cuarto', rep: 55, colors: ['#c8102e', '#ffffff'] }),

    // ===================== INGLATERRA — Premier League 2026-27 (20 clubes) =====================
    club('Arsenal', 'ENG', { stadium: 'Emirates Stadium', rep: 89, colors: ['#ef0107', '#063672'] }),
    club('Manchester City', 'ENG', { stadium: 'Etihad Stadium', rep: 88, colors: ['#6caddf', '#1c2c5b'] }),
    club('Manchester United', 'ENG', { stadium: 'Old Trafford', rep: 83, colors: ['#da291c', '#fbe122'] }),
    club('Aston Villa', 'ENG', { stadium: 'Villa Park', rep: 80, colors: ['#670e36', '#95bfe5'] }),
    club('Liverpool', 'ENG', { stadium: 'Anfield', rep: 85, colors: ['#c8102e', '#00b2a9'] }),
    club('Bournemouth', 'ENG', { stadium: 'Vitality Stadium', rep: 74, colors: ['#da291c', '#000000'] }),
    club('Sunderland', 'ENG', { stadium: 'Stadium of Light', rep: 71, colors: ['#eb172b', '#ffffff'] }),
    club('Brighton & Hove Albion', 'ENG', { stadium: 'Amex Stadium', rep: 76, colors: ['#0057b8', '#ffcd00'] }),
    club('Chelsea', 'ENG', { stadium: 'Stamford Bridge', rep: 82, colors: ['#034694', '#ffffff'] }),
    club('Tottenham Hotspur', 'ENG', { stadium: 'Tottenham Hotspur Stadium', rep: 80, colors: ['#132257', '#ffffff'] }),
    club('Newcastle United', 'ENG', { stadium: "St James' Park", rep: 79, colors: ['#241f20', '#ffffff'] }),
    club('Everton', 'ENG', { stadium: 'Hill Dickinson Stadium', rep: 73, colors: ['#003399', '#ffffff'] }),
    club('Fulham', 'ENG', { stadium: 'Craven Cottage', rep: 72, colors: ['#000000', '#ffffff'] }),
    club('Brentford', 'ENG', { stadium: 'Gtech Community Stadium', rep: 72, colors: ['#e30613', '#ffffff'] }),
    club('Crystal Palace', 'ENG', { stadium: 'Selhurst Park', rep: 73, colors: ['#1b458f', '#c4122e'] }),
    club('Nottingham Forest', 'ENG', { stadium: 'The City Ground', rep: 74, colors: ['#dd0000', '#ffffff'] }),
    club('Leeds United', 'ENG', { stadium: 'Elland Road', rep: 72, colors: ['#ffffff', '#1d428a'] }),
    club('Coventry City', 'ENG', { stadium: 'Coventry Building Society Arena', rep: 65, colors: ['#78d0f7', '#ffffff'] }),
    club('Ipswich Town', 'ENG', { stadium: 'Portman Road', rep: 64, colors: ['#0044a9', '#ffffff'] }),
    club('Hull City', 'ENG', { stadium: 'MKM Stadium', rep: 63, colors: ['#f18a00', '#000000'] }),

    // ===================== ESPANHA — LaLiga 2026-27 (20 clubes) =====================
    club('Real Madrid', 'ESP', { stadium: 'Santiago Bernabéu', rep: 91, colors: ['#ffffff', '#febe10'] }),
    club('Barcelona', 'ESP', { stadium: 'Spotify Camp Nou', rep: 89, colors: ['#a50044', '#004d98'] }),
    club('Villarreal', 'ESP', { stadium: 'Estadio de la Cerámica', rep: 79, colors: ['#ffe667', '#005187'] }),
    club('Atlético de Madrid', 'ESP', { stadium: 'Cívitas Metropolitano', rep: 84, colors: ['#c8102e', '#0b1642'] }),
    club('Real Betis', 'ESP', { stadium: 'Benito Villamarín', rep: 78, colors: ['#00954c', '#ffffff'] }),
    club('Celta de Vigo', 'ESP', { stadium: 'Balaídos', rep: 75, colors: ['#8ac6ee', '#ffffff'] }),
    club('Real Sociedad', 'ESP', { stadium: 'Reale Arena', rep: 78, colors: ['#0067b1', '#ffffff'] }),
    club('Athletic Club', 'ESP', { stadium: 'San Mamés', rep: 79, colors: ['#ee2523', '#ffffff'] }),
    club('Sevilla', 'ESP', { stadium: 'Ramón Sánchez-Pizjuán', rep: 75, colors: ['#ffffff', '#d2001c'] }),
    club('Valencia', 'ESP', { stadium: 'Mestalla', rep: 74, colors: ['#ffffff', '#ee7c0e'] }),
    club('Getafe', 'ESP', { stadium: 'Coliseum', rep: 70, colors: ['#005ba4', '#ffffff'] }),
    club('Osasuna', 'ESP', { stadium: 'El Sadar', rep: 71, colors: ['#c8102e', '#0b1642'] }),
    club('Espanyol', 'ESP', { stadium: 'RCDE Stadium', rep: 68, colors: ['#0057b8', '#ffffff'] }),
    club('Rayo Vallecano', 'ESP', { stadium: 'Vallecas', rep: 70, colors: ['#c8102e', '#ffffff'] }),
    club('Alavés', 'ESP', { stadium: 'Mendizorrotza', rep: 67, colors: ['#003399', '#ffffff'] }),
    club('Elche', 'ESP', { stadium: 'Martínez Valero', rep: 66, colors: ['#046a38', '#ffffff'] }),
    club('Levante', 'ESP', { stadium: 'Ciutat de València', rep: 67, colors: ['#00285e', '#c8102e'] }),
    club('Racing de Santander', 'ESP', { stadium: 'El Sardinero', rep: 65, colors: ['#00944d', '#ffffff'] }),
    club('Deportivo de La Coruña', 'ESP', { stadium: 'Abanca-Riazor', rep: 66, colors: ['#0057b8', '#ffffff'] }),
    club('Málaga', 'ESP', { stadium: 'La Rosaleda', rep: 64, colors: ['#0057b8', '#ffffff'] }),

    // ===================== ITÁLIA — Serie A 2026-27 (20 clubes) =====================
    club('Inter de Milão', 'ITA', { stadium: 'San Siro', rep: 88, colors: ['#0068a8', '#000000'] }),
    club('Napoli', 'ITA', { stadium: 'Diego Armando Maradona', rep: 84, colors: ['#12a0d7', '#003c71'] }),
    club('Juventus', 'ITA', { stadium: 'Allianz Stadium', rep: 83, colors: ['#000000', '#ffffff'] }),
    club('AC Milan', 'ITA', { stadium: 'San Siro', rep: 82, colors: ['#fb090b', '#000000'] }),
    club('AS Roma', 'ITA', { stadium: 'Stadio Olimpico', rep: 80, colors: ['#960a3d', '#f0bc42'] }),
    club('Atalanta', 'ITA', { stadium: 'Gewiss Stadium', rep: 80, colors: ['#1e71b8', '#000000'] }),
    club('Bologna', 'ITA', { stadium: "Renato Dall'Ara", rep: 77, colors: ['#c8102e', '#0b1642'] }),
    club('Lazio', 'ITA', { stadium: 'Stadio Olimpico', rep: 78, colors: ['#a3d5f7', '#ffffff'] }),
    club('Fiorentina', 'ITA', { stadium: 'Artemio Franchi', rep: 76, colors: ['#663399', '#ffffff'] }),
    club('Udinese', 'ITA', { stadium: 'Bluenergy Stadium', rep: 70, colors: ['#000000', '#ffffff'] }),
    club('Torino', 'ITA', { stadium: 'Stadio Olimpico Grande Torino', rep: 71, colors: ['#7b1e3c', '#ffffff'] }),
    club('Genoa', 'ITA', { stadium: 'Luigi Ferraris', rep: 68, colors: ['#c8102e', '#0b1642'] }),
    club('Como', 'ITA', { stadium: 'Giuseppe Sinigaglia', rep: 71, colors: ['#0057b8', '#ffffff'] }),
    club('Cagliari', 'ITA', { stadium: 'Unipol Domus', rep: 67, colors: ['#c8102e', '#0b1642'] }),
    club('Lecce', 'ITA', { stadium: 'Via del Mare', rep: 65, colors: ['#ffe667', '#c8102e'] }),
    club('Parma', 'ITA', { stadium: 'Ennio Tardini', rep: 66, colors: ['#f4d03f', '#003399'] }),
    club('Sassuolo', 'ITA', { stadium: 'Mapei Stadium', rep: 68, colors: ['#00944d', '#000000'] }),
    club('Venezia', 'ITA', { stadium: 'Pier Luigi Penzo', rep: 62, colors: ['#ff7f00', '#000000'] }),
    club('Frosinone', 'ITA', { stadium: 'Benito Stirpe', rep: 60, colors: ['#ffe667', '#003399'] }),
    club('Monza', 'ITA', { stadium: 'U-Power Stadium', rep: 63, colors: ['#c8102e', '#ffffff'] }),

    // ===================== ALEMANHA — Bundesliga 2026-27 (18 clubes) =====================
    club('Bayern de Munique', 'GER', { stadium: 'Allianz Arena', rep: 90, colors: ['#dc052d', '#0066b2'] }),
    club('Borussia Dortmund', 'GER', { stadium: 'Signal Iduna Park', rep: 82, colors: ['#fde100', '#000000'] }),
    club('Bayer Leverkusen', 'GER', { stadium: 'BayArena', rep: 82, colors: ['#e32221', '#000000'] }),
    club('RB Leipzig', 'GER', { stadium: 'Red Bull Arena', rep: 80, colors: ['#dd0741', '#ffffff'] }),
    club('Eintracht Frankfurt', 'GER', { stadium: 'Deutsche Bank Park', rep: 77, colors: ['#e1000f', '#000000'] }),
    club('VfB Stuttgart', 'GER', { stadium: 'MHPArena', rep: 77, colors: ['#ffffff', '#e32219'] }),
    club('Borussia Mönchengladbach', 'GER', { stadium: 'Borussia-Park', rep: 73, colors: ['#000000', '#ffffff'] }),
    club('1. FC Köln', 'GER', { stadium: 'RheinEnergieStadion', rep: 68, colors: ['#c8102e', '#ffffff'] }),
    club('Werder Bremen', 'GER', { stadium: 'Weserstadion', rep: 71, colors: ['#1d9053', '#ffffff'] }),
    club('Mainz 05', 'GER', { stadium: 'Mewa Arena', rep: 70, colors: ['#c8102e', '#ffffff'] }),
    club('Union Berlin', 'GER', { stadium: 'Stadion An der Alten Försterei', rep: 71, colors: ['#eb1923', '#ffe667'] }),
    club('SC Freiburg', 'GER', { stadium: 'Europa-Park Stadion', rep: 73, colors: ['#000000', '#ffffff'] }),
    club('FC Augsburg', 'GER', { stadium: 'WWK Arena', rep: 68, colors: ['#c8102e', '#046a38'] }),
    club('TSG Hoffenheim', 'GER', { stadium: 'PreZero Arena', rep: 69, colors: ['#1c63b7', '#ffffff'] }),
    club('Hamburger SV', 'GER', { stadium: 'Volksparkstadion', rep: 68, colors: ['#003399', '#ffffff'] }),
    club('FC Schalke 04', 'GER', { stadium: 'Veltins-Arena', rep: 66, colors: ['#004b9b', '#ffffff'] }),
    club('SV Elversberg', 'GER', { stadium: 'URSAPHARM-Arena', rep: 58, colors: ['#003399', '#ffffff'] }),
    club('SC Paderborn 07', 'GER', { stadium: 'Home Deluxe Arena', rep: 60, colors: ['#003399', '#ffffff'] }),

    // ===================== FRANÇA — Ligue 1 2026-27 (18 clubes) =====================
    club('Paris Saint-Germain', 'FRA', { stadium: 'Parc des Princes', rep: 88, colors: ['#004170', '#da291c'] }),
    club('AS Monaco', 'FRA', { stadium: 'Stade Louis II', rep: 79, colors: ['#c8102e', '#ffffff'] }),
    club('Olympique de Marselha', 'FRA', { stadium: 'Stade Vélodrome', rep: 79, colors: ['#2fa4de', '#ffffff'] }),
    club('LOSC Lille', 'FRA', { stadium: 'Stade Pierre-Mauroy', rep: 77, colors: ['#c8102e', '#0b1a40'] }),
    club('RC Lens', 'FRA', { stadium: 'Stade Bollaert-Delelis', rep: 75, colors: ['#ffcc00', '#c8102e'] }),
    club('Olympique Lyonnais', 'FRA', { stadium: 'Groupama Stadium', rep: 76, colors: ['#c8102e', '#003399'] }),
    club('OGC Nice', 'FRA', { stadium: 'Allianz Riviera', rep: 73, colors: ['#c8102e', '#000000'] }),
    club('RC Strasbourg', 'FRA', { stadium: 'Stade de la Meinau', rep: 71, colors: ['#0057b8', '#ffffff'] }),
    club('Stade Rennais FC', 'FRA', { stadium: 'Roazhon Park', rep: 73, colors: ['#c8102e', '#000000'] }),
    club('Stade Brestois 29', 'FRA', { stadium: 'Stade Francis-Le Blé', rep: 68, colors: ['#c8102e', '#ffffff'] }),
    club('AJ Auxerre', 'FRA', { stadium: 'Stade Abbé-Deschamps', rep: 65, colors: ['#003399', '#ffffff'] }),
    club('Toulouse FC', 'FRA', { stadium: 'Stadium de Toulouse', rep: 66, colors: ['#663399', '#ffffff'] }),
    club('Angers SCO', 'FRA', { stadium: 'Stade Raymond-Kopa', rep: 62, colors: ['#000000', '#ffffff'] }),
    club('Le Havre AC', 'FRA', { stadium: 'Stade Océane', rep: 63, colors: ['#0057b8', '#ffffff'] }),
    club('FC Lorient', 'FRA', { stadium: 'Stade du Moustoir', rep: 64, colors: ['#ff7f00', '#000000'] }),
    club('Paris FC', 'FRA', { stadium: 'Stade Jean-Bouin', rep: 65, colors: ['#003399', '#c8102e'] }),
    club('Le Mans FC', 'FRA', { stadium: 'Stade Marie-Marvingt', rep: 58, colors: ['#003399', '#ffffff'] }),
    club('ESTAC Troyes', 'FRA', { stadium: "Stade de l'Aube", rep: 60, colors: ['#0057b8', '#ffffff'] }),

    // ===================== PORTUGAL — Primeira Liga 2026-27 (18 clubes) =====================
    club('FC Porto', 'POR', { stadium: 'Estádio do Dragão', rep: 83, colors: ['#00447c', '#ffffff'] }),
    club('Benfica', 'POR', { stadium: 'Estádio da Luz', rep: 83, colors: ['#c8102e', '#ffffff'] }),
    club('Sporting CP', 'POR', { stadium: 'José Alvalade', rep: 82, colors: ['#ffffff', '#00843d'] }),
    club('SC Braga', 'POR', { stadium: 'Municipal de Braga', rep: 76, colors: ['#c8102e', '#ffffff'] }),
    club('Vitória de Guimarães', 'POR', { stadium: 'D. Afonso Henriques', rep: 72, colors: ['#ffffff', '#000000'] }),
    club('Famalicão', 'POR', { stadium: 'Municipal de Famalicão', rep: 68, colors: ['#c8102e', '#ffffff'] }),
    club('Moreirense', 'POR', { stadium: 'Comendador Joaquim de Almeida Freitas', rep: 64, colors: ['#046a38', '#ffffff'] }),
    club('Gil Vicente', 'POR', { stadium: 'Cidade de Barcelos', rep: 65, colors: ['#c8102e', '#ffffff'] }),
    club('Arouca', 'POR', { stadium: 'Municipal de Arouca', rep: 67, colors: ['#f4d03f', '#000000'] }),
    club('Casa Pia', 'POR', { stadium: 'Municipal de Rio Maior', rep: 63, colors: ['#046a38', '#ffffff'] }),
    club('Estoril Praia', 'POR', { stadium: 'António Coimbra da Mota', rep: 65, colors: ['#f4d03f', '#003399'] }),
    club('Estrela da Amadora', 'POR', { stadium: 'José Gomes', rep: 62, colors: ['#c8102e', '#000000'] }),
    club('Rio Ave', 'POR', { stadium: 'dos Arcos', rep: 64, colors: ['#046a38', '#ffffff'] }),
    club('Santa Clara', 'POR', { stadium: 'de São Miguel', rep: 63, colors: ['#046a38', '#ffffff'] }),
    club('Nacional', 'POR', { stadium: 'da Madeira', rep: 62, colors: ['#000000', '#ffe667'] }),
    club('Alverca', 'POR', { stadium: 'Complexo Desportivo FC Alverca', rep: 61, colors: ['#003399', '#ffffff'] }),
    club('Marítimo', 'POR', { stadium: 'dos Barreiros', rep: 61, colors: ['#046a38', '#ffffff'] }),
    club('Académico de Viseu', 'POR', { stadium: 'Municipal do Fontelo', rep: 58, colors: ['#003399', '#ffffff'] }),

    // ===================== HOLANDA — Eredivisie 2026-27 (18 clubes) =====================
    club('Ajax', 'NED', { stadium: 'Johan Cruyff Arena', rep: 80, colors: ['#d2122e', '#ffffff'] }),
    club('PSV Eindhoven', 'NED', { stadium: 'Philips Stadion', rep: 82, colors: ['#ed1c24', '#ffffff'] }),
    club('Feyenoord', 'NED', { stadium: 'De Kuip', rep: 79, colors: ['#c8102e', '#000000'] }),
    club('AZ Alkmaar', 'NED', { stadium: 'AFAS Stadion', rep: 75, colors: ['#c8102e', '#ffffff'] }),
    club('FC Twente', 'NED', { stadium: 'De Grolsch Veste', rep: 74, colors: ['#c8102e', '#ffffff'] }),
    club('FC Utrecht', 'NED', { stadium: 'Stadion Galgenwaard', rep: 71, colors: ['#c8102e', '#ffffff'] }),
    club('Go Ahead Eagles', 'NED', { stadium: 'De Adelaarshorst', rep: 65, colors: ['#c8102e', '#ffe667'] }),
    club('FC Groningen', 'NED', { stadium: 'Euroborg', rep: 66, colors: ['#046a38', '#ffffff'] }),
    club('SC Heerenveen', 'NED', { stadium: 'Abe Lenstra Stadion', rep: 65, colors: ['#003399', '#ffffff'] }),
    club('Sparta Rotterdam', 'NED', { stadium: 'Het Kasteel', rep: 62, colors: ['#c8102e', '#ffffff'] }),
    club('Fortuna Sittard', 'NED', { stadium: 'Fortuna Sittard Stadion', rep: 60, colors: ['#f4d03f', '#046a38'] }),
    club('NEC Nijmegen', 'NED', { stadium: 'Goffertstadion', rep: 63, colors: ['#c8102e', '#000000'] }),
    club('PEC Zwolle', 'NED', { stadium: 'MAC³PARK Stadion', rep: 61, colors: ['#003399', '#ffffff'] }),
    club('Excelsior', 'NED', { stadium: 'Van Donge & De Roo Stadion', rep: 58, colors: ['#c8102e', '#000000'] }),
    club('Telstar', 'NED', { stadium: 'Rabobank IJmond Stadion', rep: 56, colors: ['#046a38', '#ffffff'] }),
    club('ADO Den Haag', 'NED', { stadium: 'Bingoal Stadion', rep: 58, colors: ['#046a38', '#ffe667'] }),
    club('SC Cambuur', 'NED', { stadium: 'Cambuur Stadion', rep: 59, colors: ['#003399', '#ffe667'] }),
    club('Willem II', 'NED', { stadium: 'Koning Willem II Stadion', rep: 57, colors: ['#c8102e', '#ffffff'] }),
  ];

  function getCrest(clubObj) {
    return { remote: crestUrl(clubObj), fallback: monogramSVG(clubObj.name, clubObj.colors[0], clubObj.colors[1]) };
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
  // NAME POOLS
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

  // ---------------------------------------------------------------------
  // NATIONALITIES + CONFEDERATION MAP — this is what fixes the "Brazil in
  // the Eurocopa" bug: national-team competitions are chosen strictly by
  // the confederation the player's nationality belongs to.
  // ---------------------------------------------------------------------
  const CONFEDERATIONS = {
    CONMEBOL: ['Brasil', 'Argentina', 'Uruguai', 'Colômbia', 'Chile', 'Paraguai', 'Peru', 'Equador', 'Bolívia', 'Venezuela'],
    UEFA: ['Inglaterra', 'Espanha', 'Itália', 'Alemanha', 'França', 'Portugal', 'Holanda', 'Bélgica', 'Croácia'],
    CONCACAF: ['Estados Unidos', 'México', 'Canadá'],
    CAF: ['Nigéria', 'Senegal', 'Marrocos'],
    AFC: ['Japão', 'Coreia do Sul'],
  };

  const NATIONAL_COMPETITIONS_BY_CONFEDERATION = {
    CONMEBOL: ['Eliminatórias Sul-Americanas', 'Copa América', 'Copa do Mundo', 'Amistoso Internacional'],
    UEFA: ['Eliminatórias Europeias', 'Eurocopa', 'Liga das Nações', 'Copa do Mundo', 'Amistoso Internacional'],
    CONCACAF: ['Eliminatórias da CONCACAF', 'Copa Ouro', 'Copa do Mundo', 'Amistoso Internacional'],
    CAF: ['Eliminatórias Africanas', 'Copa Africana de Nações', 'Copa do Mundo', 'Amistoso Internacional'],
    AFC: ['Eliminatórias Asiáticas', 'Copa da Ásia', 'Copa do Mundo', 'Amistoso Internacional'],
  };

  const NATIONALITIES = Object.keys(CONFEDERATIONS).reduce((acc, k) => acc.concat(CONFEDERATIONS[k]), []).concat(['Outra']);

  function confederationOf(nationality) {
    return Object.keys(CONFEDERATIONS).find(k => CONFEDERATIONS[k].includes(nationality)) || null;
  }
  function nationalCompetitionsFor(nationality) {
    const conf = confederationOf(nationality);
    return conf ? NATIONAL_COMPETITIONS_BY_CONFEDERATION[conf] : ['Amistoso Internacional'];
  }

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

  // ---------------------------------------------------------------------
  // SCHEDULE / BRACKET GENERATORS — always pre-filtered by caller to a
  // single league/state/zone group, so fixtures never cross competitions.
  // ---------------------------------------------------------------------
  function clubsByLeague(leagueCode) { return CLUBS.filter(c => c.league === leagueCode); }
  function clubsByCountry(country) {
    const code = Object.keys(LEAGUES).find(k => LEAGUES[k].country === country);
    return code ? clubsByLeague(code) : [];
  }
  function clubsByState(leagueCode, state) { return CLUBS.filter(c => c.league === leagueCode && c.state === state); }
  function clubsByZone(leagueCode, zone) { return CLUBS.filter(c => c.league === leagueCode && c.zone === zone); }

  function roundRobinSchedule(clubIds, doubleRound) {
    let ids = clubIds.slice();
    const bye = ids.length % 2 !== 0;
    if (bye) ids.push(null);
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

  function knockoutBracket(clubIds) {
    const ids = clubIds.slice();
    let size = 2; while (size < ids.length) size *= 2;
    while (ids.length < size) ids.push(null);
    const round1 = [];
    for (let i = 0; i < size / 2; i++) round1.push({ home: ids[i], away: ids[size - 1 - i] });
    return round1;
  }

  return {
    LEAGUES, ESTADUAIS, CUPS, CLUBS, SPONSORS, NAME_POOLS, NATIONALITIES, POSITIONS,
    POSITION_NAMES, CONFEDERATIONS,
    getCrest, clubsByLeague, clubsByCountry, clubsByState, clubsByZone,
    randomPlayerName, pick, slug, confederationOf, nationalCompetitionsFor,
    roundRobinSchedule, knockoutBracket,
  };
})();
