/**
 * Purulia 2040 — Form Handler
 * Google Apps Script — deploys as a web app endpoint
 */

const TO_EMAIL       = 'thelosthillproject@gmail.com';
const SHEET_NAME     = 'Submissions';
const SPREADSHEET_ID = '17HN5pN74XgCreHRNgUDMdj2A6-RldS3ID-4WoIpeZDQ';

const REPORTS_SHEET_NAME = 'Reports';
const REPORTS_DRIVE_FOLDER = 'Purulia 2040 — Report Photos';

// ── Handlers ─────────────────────────────────────────────────────────────────

function doGet(e) {
  const action = e.parameter && e.parameter.action;
  if (action === 'getReports') {
    return getReports(e.parameter.category);
  }
  return processSubmission(e.parameter);
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    Logger.log('doPost parse error: ' + err);
    return jsonResponse({success: false, error: err.toString()});
  }

  if (data.type === 'report') {
    return saveReport(data);
  }
  return processSubmission(data);
}

// ── Core logic ────────────────────────────────────────────────────────────────

function processSubmission(data) {
  try {
    Logger.log('Received: ' + JSON.stringify(data));

    const ss = openSheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(['Timestamp', 'Name', 'Role', 'Location', 'Message', 'Contact']);
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'}),
      data.name    || '',
      data.role    || '',
      data.location|| '',
      data.message || '',
      data.contact || ''
    ]);

    Logger.log('Row written successfully');

    const applicantEmail = (data.contact || '').includes('@') ? data.contact : '';

    // Notify the team
    MailApp.sendEmail({
      to: TO_EMAIL,
      subject: 'Purulia 2040 — ' + (data.name || '(no name)') + ' (' + (data.role || '?') + ')',
      replyTo: applicantEmail,
      body: [
        'New submission from Purulia 2040\n',
        'Name:     ' + data.name,
        'Role:     ' + data.role,
        'Location: ' + data.location,
        'Contact:  ' + data.contact,
        '',
        'Message:',
        data.message
      ].join('\n')
    });

    // Send The Purulia Protocols to the applicant
    if (applicantEmail) {
      const firstName = (data.name || 'Friend').split(' ')[0];
      MailApp.sendEmail({
        to: applicantEmail,
        subject: 'The Purulia Protocols — Your Copy',
        replyTo: TO_EMAIL,
        htmlBody: buildProtocolsEmail(firstName)
      });
    }

    return jsonResponse({success: true});

  } catch (err) {
    Logger.log('processSubmission error: ' + err);
    return jsonResponse({success: false, error: err.toString()});
  }
}

// ── Reports (map & Purulia Kasa waste tracker) ─────────────────────────────────

function saveReport(data) {
  try {
    const ss = openSheet();
    let sheet = ss.getSheetByName(REPORTS_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(REPORTS_SHEET_NAME);
      sheet.appendRow(['Timestamp', 'ID', 'Category', 'Lat', 'Lng', 'Ward', 'Block', 'Description', 'Name', 'PhotoURL', 'Status']);
      sheet.setFrozenRows(1);
    }

    const id = 'R' + Date.now() + Math.floor(Math.random() * 1000);
    let photoUrl = '';
    if (data.photo) {
      try {
        photoUrl = savePhotoToDrive(data.photo, id);
      } catch (photoErr) {
        Logger.log('Photo save error: ' + photoErr);
      }
    }

    sheet.appendRow([
      new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'}),
      id,
      data.category || 'other',
      data.lat || '',
      data.lng || '',
      data.ward || '',
      data.block || '',
      data.desc || '',
      data.name || 'Anonymous',
      photoUrl,
      'new'
    ]);

    return jsonResponse({success: true, id: id, photoUrl: photoUrl});
  } catch (err) {
    Logger.log('saveReport error: ' + err);
    return jsonResponse({success: false, error: err.toString()});
  }
}

function savePhotoToDrive(dataUrl, id) {
  const match = String(dataUrl).match(/^data:(image\/\w+);base64,(.*)$/);
  if (!match) return '';
  const mimeType = match[1];
  const base64 = match[2];
  const bytes = Utilities.base64Decode(base64);
  const ext = mimeType.split('/')[1] || 'jpg';
  const blob = Utilities.newBlob(bytes, mimeType, id + '.' + ext);

  const folders = DriveApp.getFoldersByName(REPORTS_DRIVE_FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(REPORTS_DRIVE_FOLDER);

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/uc?export=view&id=' + file.getId();
}

function getReports(category) {
  try {
    const ss = openSheet();
    const sheet = ss.getSheetByName(REPORTS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) {
      return jsonOutput({success: true, reports: []});
    }

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
    let reports = rows.map(function(r) {
      return {
        ts: r[0] ? new Date(r[0]).getTime() || String(r[0]) : '',
        id: r[1],
        category: r[2],
        lat: parseFloat(r[3]),
        lng: parseFloat(r[4]),
        ward: r[5],
        block: r[6],
        desc: r[7],
        name: r[8],
        photoUrl: r[9],
        status: r[10] || 'new'
      };
    }).filter(function(r) {
      return !isNaN(r.lat) && !isNaN(r.lng);
    });

    if (category) {
      reports = reports.filter(function(r) { return r.category === category; });
    }

    return jsonOutput({success: true, reports: reports});
  } catch (err) {
    Logger.log('getReports error: ' + err);
    return jsonOutput({success: false, error: err.toString(), reports: []});
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function openSheet() {
  // Now it just checks if an ID is provided, without blocking your specific ID
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      'Cannot find spreadsheet. Either: (a) open this script from inside ' +
      'your Google Sheet via Extensions → Apps Script, OR (b) paste your ' +
      'Sheet ID into the SPREADSHEET_ID constant at the top of this file.'
    );
  }
  return ss;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(obj.success ? "Success" : "Error: " + obj.error)
    .setMimeType(ContentService.MimeType.TEXT);
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildProtocolsEmail(firstName) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Georgia, serif; background: #0d0d0d; color: #f0e6d0; margin: 0; padding: 0; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 48px 32px; }
  h1 { font-size: 28px; font-weight: 700; color: #D4882A; margin: 0 0 4px; letter-spacing: 0.02em; }
  .sub { font-size: 14px; color: rgba(240,230,208,0.45); margin: 0 0 40px; font-style: italic; }
  .intro { font-size: 16px; line-height: 1.7; margin-bottom: 40px; border-left: 2px solid #D4882A; padding-left: 20px; }
  h2 { font-size: 18px; color: #D4882A; margin: 40px 0 4px; text-transform: uppercase; letter-spacing: 0.08em; }
  .book-sub { font-size: 13px; color: rgba(240,230,208,0.45); margin: 0 0 16px; font-style: italic; }
  p { font-size: 15px; line-height: 1.75; margin: 0 0 14px; }
  ul { margin: 8px 0 16px 0; padding-left: 20px; }
  li { font-size: 14px; line-height: 1.7; margin-bottom: 6px; }
  .chapter { margin: 24px 0; }
  .chapter-title { font-size: 15px; font-weight: 700; color: #f0e6d0; margin: 0 0 4px; }
  .chapter-sub { font-size: 13px; color: rgba(240,230,208,0.45); font-style: italic; margin: 0 0 10px; }
  .divider { border: none; border-top: 1px solid rgba(212,136,42,0.2); margin: 40px 0; }
  .oath { background: rgba(212,136,42,0.07); border: 1px solid rgba(212,136,42,0.3); border-radius: 4px; padding: 28px 32px; margin-top: 40px; }
  .oath h2 { margin-top: 0; }
  .oath p { font-style: italic; }
  .sig-line { border-bottom: 1px solid rgba(240,230,208,0.3); width: 240px; display: inline-block; margin: 16px 0 4px; }
  .footer { margin-top: 48px; font-size: 12px; color: rgba(240,230,208,0.25); text-align: center; }
</style>
</head>
<body>
<div class="wrap">

  <h1>PROJECT ASCENSION</h1>
  <div class="sub">The Purulia Protocols (2026–2031) &nbsp;·&nbsp; The Universe Edition, Books I–VI</div>

  <div class="intro">
    Dear ${firstName},<br><br>
    Thank you for joining Purulia 2040. You asked to be part of something real —
    so here is the operating system behind it.<br><br>
    This is not a newsletter. It is a doctrine. Six protocols for anyone who refuses
    to let Purulia remain an afterthought. Read it once. Then decide what you will build.
  </div>

  <p style="font-style:italic;color:rgba(240,230,208,0.5);">
    "Purulia is not a problem to be solved. It is a story waiting to be written."
  </p>

  <hr class="divider">

  <!-- BOOK I -->
  <h2>Book I — The Statesman's Protocol</h2>
  <div class="book-sub">Governing Purulia in the Age of Scarcity</div>
  <p>Purulia's politics has long run on one engine: promise relief, win votes, repeat. The treasury empties. The roads stay broken. The youth keep leaving. We are shifting from <strong>Patronage</strong> (The Provider) to <strong>Platform</strong> (The Builder).</p>

  <div class="chapter">
    <div class="chapter-title">Ch.1 — The Asset Swap</div>
    <div class="chapter-sub">The Death of the Freebie</div>
    <ul>
      <li><strong>The Trap:</strong> Revenue expenditure burns cash forever and creates zero assets.</li>
      <li><strong>The Protocol:</strong> Swap "Consumption Relief" for "Asset Relief" — Free Rooftop Solar Panels instead of subsidised bills. E-Rickshaw Fleets for women's SHGs instead of free bus passes.</li>
      <li><strong>The Logic:</strong> A freebie reminds the voter they are poor. An asset reminds them they are progressing.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.2 — The Disadvantage Index (DIS)</div>
    <div class="chapter-sub">Beyond Caste, Into Context</div>
    <ul>
      <li><strong>The Trap:</strong> Elite Capture — treating a government employee's child the same as a landless Santali labourer's daughter.</li>
      <li><strong>The Protocol:</strong> A dynamic DIS Score (0–100) based on Geography (block-level penalty), Schooling, and Economics.</li>
      <li><strong>The Logic:</strong> We do not abolish reservation; we upgrade it. We target the <em>context</em>, not just the category.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.3 — The Tier-2 Engine</div>
    <div class="chapter-sub">Purulia as a Heritage Capital</div>
    <ul>
      <li><strong>The Protocol:</strong> Directly Elected Mayor with real executive power. Municipal Bonds for fiscal discipline. One identity: <em>Purulia is the Chhau Capital of the World.</em></li>
      <li><strong>The Logic:</strong> A district is not a dormitory for Kolkata's workforce. It is a civilisation in its own right.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.4 — The Feedback Loop</div>
    <div class="chapter-sub">Zero Latency Governance</div>
    <ul>
      <li>Gram Sabha micro-budgets for instant local repairs.</li>
      <li>Every grievance gets a tracking ID and an auto-escalation timer.</li>
      <li>AI-assisted vernacular monitoring (Santali, Bengali, Hindi) to catch anger before it spreads.</li>
    </ul>
  </div>

  <hr class="divider">

  <!-- BOOK II -->
  <h2>Book II — The Great Climb</h2>
  <div class="book-sub">The Personal Operating System for Purulia's Builders</div>
  <p>You cannot rebuild Purulia if you are broke or burnt out. Self-mastery is the prerequisite for public impact.</p>

  <div class="chapter">
    <div class="chapter-title">Ch.1 — The Financial Fort &nbsp;<span style="font-weight:400;font-style:italic;font-size:13px;">50-30-20 Rule</span></div>
    <ul>
      <li>50% Needs · 30% Wants · 20% Investments — the non-negotiable tax you pay to your future self.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.2 — The Portfolio Architecture</div>
    <ul>
      <li><strong>Core (70%):</strong> Nifty 50 Index Fund. Passive. Low cost.</li>
      <li><strong>Satellite (30%):</strong> Mid/Small-Cap. Higher risk, higher return.</li>
      <li><strong>Hedge:</strong> Sovereign Gold Bonds + 6-month Emergency Fund.</li>
      <li><strong>The Rule:</strong> Salary Credit → SIP Auto-Debit (5th of month) → Expenses. Never reverse this order.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.3 — The Bio-Stack &nbsp;<span style="font-weight:400;font-style:italic;font-size:13px;">Health as Infrastructure</span></div>
    <ul>
      <li>Sleep: Non-negotiable 7 hours.</li>
      <li>Diet: High Protein, Low Sugar.</li>
      <li>Movement: Daily. Ajodhya Hills counts.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.4 — The Deep Work Protocol</div>
    <ul>
      <li>4 hours of uninterrupted focus daily = 12 hours of scattered effort.</li>
      <li>No phone for the first 60 minutes after waking.</li>
    </ul>
  </div>

  <hr class="divider">

  <!-- BOOK III -->
  <h2>Book III — Building Purulia</h2>
  <div class="book-sub">The Founder's Map to Purulia's Untapped Opportunities</div>
  <p>Purulia is not poor in resources. It is poor in organised attention. Ajodhya Hills, Chhau, Garpanchkot, tribal crafts, solar irradiance — all of it sits waiting.</p>

  <div class="chapter">
    <div class="chapter-title">Ch.1 — The Three Purulias</div>
    <ul>
      <li><strong>Purulia 1 (The Town):</strong> Served. Competitive. Incremental opportunity.</li>
      <li><strong>Purulia 2 (The Blocks):</strong> Raghunathpur, Jhalda, Manbazar. Aspirational. High-growth potential.</li>
      <li><strong>Purulia 3 (The Villages):</strong> Bandwan, Bagmundi. Subsistence. Needs infrastructure before apps.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.2 — The India Stack Advantage</div>
    <ul>
      <li>Aadhaar/eKYC — unlock banking for every tribal household.</li>
      <li>UPI — zero-friction payments at village haats.</li>
      <li>ONDC — list Tussar silk, Dokra craft, and Chhau masks on national networks.</li>
      <li>Account Aggregator — cash-flow lending for farmers and artisans without collateral.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.3 — Purulia's Five Winning Sectors</div>
    <ul>
      <li><strong>Heritage Tourism:</strong> Garpanchkot, Joychandi Pahar, Ajodhya Hills — a curated 3-day circuit with homestays.</li>
      <li><strong>Chhau as Cultural Export:</strong> Academies, international festivals, branded merchandise. Chhau is Purulia's Cirque du Soleil.</li>
      <li><strong>Tribal Craft Economy:</strong> GI tags for Dokra and Tussar. Direct-to-consumer. Eliminate middlemen.</li>
      <li><strong>Agri-Tech:</strong> Drones as a Service for spraying and crop monitoring. Cold storage chains.</li>
      <li><strong>Renewable Energy:</strong> Highest solar irradiance in West Bengal. Micro-grids for remote blocks. Battery assembly as local industry.</li>
    </ul>
  </div>

  <hr class="divider">

  <!-- BOOK IV -->
  <h2>Book IV — The Dynasty</h2>
  <div class="book-sub">Building Multi-Generational Roots in Purulia</div>
  <p>"Born in Purulia, buried in Kolkata." Three generations and the land is sold, the language is lost, and no one remembers why the family left. To break this cycle, build something worth staying for.</p>

  <div class="chapter">
    <div class="chapter-title">Ch.1 — The Family Constitution</div>
    <ul>
      <li><strong>Productive Asset Rule:</strong> Never sell ancestral land to fund lifestyle.</li>
      <li><strong>Radical Truth:</strong> Politeness is secondary to effectiveness.</li>
      <li><strong>No Free Lunch:</strong> Support is guaranteed; comfort without contribution is not.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.2 — The Family Bank</div>
    <ul>
      <li>0% Education Loans for the next generation.</li>
      <li>Seed funding for family business ideas (small equity stake).</li>
      <li>Down-payment grants so young members can build in Purulia, not rent in Kolkata.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.3 — The Education of the Next Generation</div>
    <ul>
      <li>No allowance without a contribution — farm, shop, or family project.</li>
      <li>Immersion year in a remote Purulia block before college.</li>
      <li>Humility internship: ground-level work to kill the entitled graduate syndrome.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.4 — The Succession Plan</div>
    <ul>
      <li>Separate Ownership (returns) from Management (operations).</li>
      <li>Blood gives you the roots and the returns — not the right to manage unless you earn it.</li>
    </ul>
  </div>

  <hr class="divider">

  <!-- BOOK V -->
  <h2>Book V — The Theater of Power</h2>
  <div class="book-sub">How to Champion Purulia on Every Stage</div>

  <div class="chapter">
    <div class="chapter-title">Ch.1 — The Optic</div>
    <ul>
      <li>Wear Purulia's identity — a Chhau motif, Tussar fabric — in every important room you enter.</li>
      <li>Never dress like a supplicant. Dress like an ambassador presenting Purulia's offer.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.2 — The Tongue of Fire</div>
    <ul>
      <li>Facts tell, Stories sell. Use the Rule of Three: "Restore the Land, Revive the Culture, Rebuild the Future."</li>
      <li>Lead with Purulia's assets, not its deficits. Silence signals confidence. Speak slowly.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.3 — The Useful Enemy</div>
    <ul>
      <li>Run against neglect, migration, and apathy — not people.</li>
      <li>"Purulia has been left behind long enough. We are here to change the equation."</li>
    </ul>
  </div>

  <hr class="divider">

  <!-- BOOK VI -->
  <h2>Book VI — The Red Book</h2>
  <div class="book-sub">The Laws of Selection (Desire, Shadow, and Betrayal)</div>

  <div class="chapter">
    <div class="chapter-title">Ch.1 — The Partner Protocol</div>
    <ul>
      <li>Partnership is a Merger. Due diligence is mandatory.</li>
      <li>Stress Test: Travel somewhere difficult together. Do they complain or solve?</li>
      <li>A mission this long needs a co-founder at home, not a sceptic.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.2 — The Brutus Filter</div>
    <ul>
      <li>The Gossip Test: Share a non-critical secret. If it spreads, remove them.</li>
      <li>Competence over loyalty — but treacherous competence is fatal.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.3 — The Shadow Integration</div>
    <ul>
      <li>Develop the capacity for decisive action — and hold it in reserve.</li>
      <li>Builders who cannot protect what they build, lose it.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Ch.4 — The Transmutation</div>
    <ul>
      <li>Cut low-quality dopamine habits. Non-negotiable.</li>
      <li>Channel the freed energy into the work.</li>
      <li>A person who cannot govern their own attention cannot govern a district.</li>
    </ul>
  </div>

  <hr class="divider">

  <!-- APPENDICES -->
  <h2>Appendices — The Defense Protocols</h2>

  <div class="chapter">
    <div class="chapter-title">Appendix A — The Iron Dome (Risk Management)</div>
    <ul>
      <li>Hold assets in LLPs or Trusts — not solely personal names.</li>
      <li>Annual social media audit. Know your digital footprint.</li>
      <li>NDAs for key staff. Protect your plans until they are real.</li>
    </ul>
  </div>

  <div class="chapter">
    <div class="chapter-title">Appendix B — The Quiet Room (Resilience)</div>
    <ul>
      <li>Find a physical sanctuary in Purulia — a hilltop, a riverbank — for deep thought. No phones.</li>
      <li>Practice Negative Visualisation: imagine the worst, prepare for it, inoculate against fear.</li>
    </ul>
  </div>

  <hr class="divider">

  <!-- OATH -->
  <div class="oath">
    <h2 style="margin-top:0;">The Builder's Oath</h2>
    <p>I, __________________________, commit to Purulia.</p>
    <p>I will not wait for permission. I will not wait for someone else.</p>
    <p>I acknowledge that knowledge without execution is vanity.<br>
    I acknowledge that the path will be lonely, difficult, and unfair.<br>
    I accept this.</p>
    <p>I will not complain. I will not drift. I will build.</p>
    <p><strong>For Purulia.</strong></p>
    <div><div class="sig-line"></div><br><span style="font-size:12px;color:rgba(240,230,208,0.35);">Signed</span></div>
    <div style="margin-top:16px;"><div class="sig-line"></div><br><span style="font-size:12px;color:rgba(240,230,208,0.35);">Date</span></div>
  </div>

  <div class="footer">
    Purulia 2040 · A District Transformation Blueprint · West Bengal, India<br>
    Reply to this email or reach us at thelosthillproject@gmail.com
  </div>

</div>
</body>
</html>`;
}
