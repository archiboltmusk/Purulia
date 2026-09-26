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

  // MLA / MP leaderboard on analytics.html. Town reports (with a ward) go to the
  // constituency marked `town: true`; village reports go by CD block. A block
  // split between two assembly seats is listed under the one holding most of it
  // (see `note`). Anything not listed shows as "Not mapped yet" — never guess:
  // a wrong row blames the wrong person. Check against the Delimitation Order /
  // CEO West Bengal and update after every election.
  constituencies: [
    { no: 242, name: 'Purulia', mla: 'mla', lokSabha: 'Purulia', town: true, blocks: [] }
  ],
  // Lok Sabha seats: `mp` names a key in `reps`, or give { name, party } directly.
  lokSabha: {
    Purulia: { mp: 'mp' }
  },

  // Official channels shown under "Take it further". Checked September 2026; keep current.
  stateHelpline: '8282082820',
  stateHelplineDisplay: '82820 82820',
  stateHelplineEmail: 'asap@wb.gov.in',
  powerUtilityUrl: 'https://www.wbsedcl.in/',
  rtiPortalUrl: 'https://par.wb.gov.in/rtilogin.php'
};
