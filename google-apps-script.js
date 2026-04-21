/**
 * Purulia 2040 — Form Handler
 * Google Apps Script — deploys as a web app endpoint
 *
 * ── SETUP (one time) ─────────────────────────────────────────────────────────
 *
 *  STEP 1 — Get your Spreadsheet ID
 *    Open your Google Sheet. The URL looks like:
 *      https://docs.google.com/spreadsheets/d/XXXXXXXXXXXXXXXX/edit
 *    Copy the XXXXXXXXXXXXXXXX part and paste it as SPREADSHEET_ID below.
 *
 *  STEP 2 — Paste this code into Apps Script
 *    In your Google Sheet: Extensions → Apps Script → replace all code → Save.
 *    OR go to script.google.com → New project → replace all code → Save.
 *
 *  STEP 3 — Deploy
 *    Click Deploy → New Deployment (or Manage Deployments → edit existing)
 *      Type:            Web App
 *      Execute as:      Me
 *      Who has access:  Anyone
 *    Click Deploy → copy the Web App URL.
 *
 *  STEP 4 — Wire up the URL
 *    Paste that URL as SCRIPT_URL in index.html.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TO_EMAIL       = 'thelosthillproject@gmail.com';
const SHEET_NAME     = 'Submissions';
const SPREADSHEET_ID = '17HN5pN74XgCreHRNgUDMdj2A6-RldS3ID-4WoIpeZDQ'; // ← paste your Sheet ID here

// ── Handlers ─────────────────────────────────────────────────────────────────

function doGet(e) {
  return processSubmission(e.parameter);
}

function doPost(e) {
  try {
    return processSubmission(JSON.parse(e.postData.contents));
  } catch (err) {
    Logger.log('doPost parse error: ' + err);
    return jsonResponse({success: false, error: err.toString()});
  }
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

    const replyTo = (data.contact || '').includes('@') ? data.contact : '';
    MailApp.sendEmail({
      to: TO_EMAIL,
      subject: 'Purulia 2040 — ' + (data.name || '(no name)') + ' (' + (data.role || '?') + ')',
      replyTo: replyTo,
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

    return jsonResponse({success: true});

  } catch (err) {
    Logger.log('processSubmission error: ' + err);
    return jsonResponse({success: false, error: err.toString()});
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function openSheet() {
  // Use the explicit ID if provided; otherwise assume this script is bound
  // to the spreadsheet (opened via Extensions → Apps Script inside the sheet).
  if (SPREADSHEET_ID && SPREADSHEET_ID !== '17HN5pN74XgCreHRNgUDMdj2A6-RldS3ID-4WoIpeZDQ') {
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
  // Simple text output is more reliable for 'no-cors' requests
  return ContentService
    .createTextOutput(obj.success ? "Success" : "Error: " + obj.error)
    .setMimeType(ContentService.MimeType.TEXT);
}
