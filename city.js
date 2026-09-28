/* Parishkar — everything that makes this deployment Purulia.
 *
 * Another town replaces this file (plus the two boundary files it names, the
 * representative photos in reps/, and the database settings listed in
 * DEPLOY.md). kasa.js reads only from here for local names, places and
 * contacts; each value falls back to Purulia's if it's missing.
 */
window.KASA_CITY = {
  name: 'Purulia',

  // Map start point [lng, lat] and zoom. The server's own boundary check is the
  // `bbox` setting in kasa_private.settings, not this.
  mapCenter: [86.3654, 23.3320],
  mapZoom: 13,

  // A fix only counts if the problem isn't reported again at the spot within this many days.
  fixMustLastDays: 14,

  // Ward outlines (town) and CD-block outlines (villages). GeoJSON, properties
  // `ward` / `block` respectively.
  wardsGeojson: 'purulia_wards.geojson',
  blocksGeojson: 'purulia_blocks.geojson',

  // The town's own complaint desk. WhatsApp number in international form, no +.
  municipalityPhone: '919046003666',
  municipalityEmail: 'puruliamunicipality@gmail.com',
  mlaTwitterHandle: 'SudipKMukherjee',

  // photo: a file in reps/ whose licence allows reuse; photoCredit: the attribution it
  // requires; photoPos: optional crop point.
  reps: {
    mla: { name: 'Sudip Kumar Mukherjee', role: 'rep_mla_role', party: 'BJP', initials: 'SKM', photo: 'reps/mla-sudip-kumar-mukherjee.jpg', photoCredit: '' },
    mp: { name: 'Jyotirmay Singh Mahato', role: 'rep_mp_role', party: 'BJP', initials: 'JSM', photo: 'reps/mp-jyotirmay-singh-mahato.webp', photoCredit: '' },
    chairman: { name: 'Nabendu Mahali', role: 'rep_chair_role', party: 'AITC', initials: 'NM', meta: 'rep_chair_meta', photo: 'reps/chairman-nabendu-mahali.jpg', photoCredit: '', photoPos: '62% 38%' }
  },

  // MLA / MP leaderboard on analytics.html.
  // Seats and their areas: Delimitation Commission Order No. 18 (15 Feb 2006).
  // MLAs: 2026 West Bengal assembly election. MPs: 2024 Lok Sabha election.
  // Checked September 2026 — update after every election. Block names must match
  // purulia_blocks.geojson (hence "Bagmundi", "Bundwan", "Jaipur").
  // Town reports (with a ward) count toward the seat marked `town: true`; village
  // reports count by CD block. A block split between seats is never guessed: it
  // gets its own row under `splitBlocks`.
  constituencies: [
    { no: 238, name: 'Bandwan (ST)',      mla: { name: 'Labsen Baskey', party: 'BJP' },       lokSabha: 'Jhargram', blocks: ['Bundwan', 'Barabazar', 'Manbazar II'] },
    { no: 239, name: 'Balarampur',        mla: { name: 'Jaladhar Mahato', party: 'BJP' },     lokSabha: 'Purulia',  blocks: ['Balarampur'] },
    { no: 240, name: 'Baghmundi',         mla: { name: 'Rahidas Mahato', party: 'BJP' },      lokSabha: 'Purulia',  blocks: ['Bagmundi', 'Jhalda I'] },
    { no: 241, name: 'Joypur',            mla: { name: 'Biswajit Mahato', party: 'BJP' },     lokSabha: 'Purulia',  blocks: ['Jaipur', 'Jhalda II'] },
    { no: 242, name: 'Purulia',           mla: { name: 'Sudip Kumar Mukherjee', party: 'BJP' }, lokSabha: 'Purulia', town: true, blocks: ['Purulia II'] },
    { no: 243, name: 'Manbazar (ST)',     mla: { name: 'Mayna Murmu', party: 'BJP' },         lokSabha: 'Purulia',  blocks: ['Manbazar I', 'Puncha'] },
    { no: 244, name: 'Kashipur',          mla: { name: 'Kamalakanta Hansda', party: 'BJP' },  lokSabha: 'Purulia',  blocks: ['Kashipur'] },
    { no: 245, name: 'Para (SC)',         mla: { name: 'Nadiar Chand Bouri', party: 'BJP' },  lokSabha: 'Purulia',  blocks: ['Para', 'Raghunathpur II'] },
    { no: 246, name: 'Raghunathpur (SC)', mla: { name: 'Mamoni Bauri', party: 'BJP' },        lokSabha: 'Bankura',  blocks: ['Raghunathpur I', 'Neturia', 'Santuri'] }
  ],
  // Blocks whose gram panchayats are divided between assembly seats.
  splitBlocks: {
    'Arsha':     { seats: [239, 240, 241], lokSabha: 'Purulia' },
    'Purulia I': { seats: [239, 242],      lokSabha: 'Purulia' },
    'Hura':      { seats: [243, 244],      lokSabha: 'Purulia' }
  },
  // Lok Sabha seats: `mp` names a key in `reps`, or give { name, party } directly.
  // mplads: the MP's local area fund for the current term, from the official MPLADS portal
  // as shown by Empowered Indian (amounts in rupees). Update `asOf` with the numbers.
  lokSabha: {
    Purulia:  { mp: 'mp', mplads: { allocated: 147000000, recommended: 71300960, spent: 11711831, worksRecommended: 107, worksCompleted: 15, asOf: '2026-09-03',
                url: 'https://empoweredindian.in/mplads/mps/shri-jyotirmay-singh-mahato-purulia-west-bengal-18th-lok-sabha' } },
    Jhargram: { mp: { name: 'Kalipada Soren', party: 'AITC' }, mplads: { allocated: 147000000, recommended: 113497279, spent: 71784126, worksRecommended: 63, worksCompleted: 40, asOf: '2026-09-03',
                url: 'https://empoweredindian.in/mplads/mps/kalipada-saren-jhargram-west-bengal-18th-lok-sabha' } },
    Bankura:  { mp: { name: 'Arup Chakraborty', party: 'AITC' }, mplads: { allocated: 147000000, recommended: 94625897, spent: 55795450, worksRecommended: 70, worksCompleted: 40, asOf: '2026-09-03',
                url: 'https://empoweredindian.in/mplads/mps/arup-chakraborty-bankura-west-bengal-18th-lok-sabha' } }
  },

  // Every municipality in the district (purulia.gov.in lists three) and the Zilla Parishad,
  // for the full list of representatives on the report map. `chair` names a key in `reps`,
  // or give { name, party } directly with the source it came from. Leave `party` out unless
  // a source states it. Checked September 2026; keep current.
  municipalities: [
    { name: 'Purulia', chair: 'chairman', town: true, source: 'https://purulia.gov.in/block-municipality/', sourceName: 'purulia.gov.in' },
    { name: 'Jhalda', block: 'Jhalda I', chair: { name: 'Suresh Agarwal' },
      source: 'https://www.youtube.com/watch?v=7hrDiPYv6YI', sourceName: 'Sangbad Pratidin, 3 Feb 2024 (elected after a trust vote)' },
    { name: 'Raghunathpur', block: 'Raghunathpur I', chair: { name: 'Tarani Bauri' },
      source: 'https://tv9bangla.com/west-bengal/purulia/bjp-alleges-rs-8-crore-corruption-in-raghunathpur-municipality-submits-red-and-blue-files-1328123.html', sourceName: 'TV9 Bangla, 3 Jul 2026' }
  ],
  zillaParishad: { name: 'Nivedita Mahato', source: 'https://purulia.gov.in/zilla-parishad/', sourceName: 'purulia.gov.in, updated 15 Sep 2026' },
  // Where the MLA and MP names above come from.
  repSources: {
    mla: { url: 'https://en.wikipedia.org/wiki/2026_West_Bengal_Legislative_Assembly_election', name: '2026 assembly election results' },
    mp: { url: 'https://en.wikipedia.org/wiki/2024_Indian_general_election_in_West_Bengal', name: '2024 Lok Sabha election results' }
  },

  // Official channels shown under "Take it further". Checked September 2026; keep current.
  stateHelpline: '8282082820',
  stateHelplineDisplay: '82820 82820',
  stateHelplineEmail: 'asap@wb.gov.in',
  powerUtilityUrl: 'https://www.wbsedcl.in/',
  rtiPortalUrl: 'https://par.wb.gov.in/rtilogin.php'
};
