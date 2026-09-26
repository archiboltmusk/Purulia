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
  lokSabha: {
    Purulia:  { mp: 'mp' },
    Jhargram: { mp: { name: 'Kalipada Soren', party: 'AITC' } },
    Bankura:  { mp: { name: 'Arup Chakraborty', party: 'AITC' } }
  },

  // Official channels shown under "Take it further". Checked September 2026; keep current.
  stateHelpline: '8282082820',
  stateHelplineDisplay: '82820 82820',
  stateHelplineEmail: 'asap@wb.gov.in',
  powerUtilityUrl: 'https://www.wbsedcl.in/',
  rtiPortalUrl: 'https://par.wb.gov.in/rtilogin.php'
};
