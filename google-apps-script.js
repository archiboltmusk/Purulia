/**
 * Purulia 2040 — Form Handler
 * Google Apps Script — deploys as a web app endpoint
 *
 * SETUP (one time, ~5 minutes):
 *   1. Open Google Sheets → create a new sheet → name it anything
 *   2. Extensions → Apps Script → paste this entire file → save
 *   3. Click Deploy → New Deployment
 *        Type: Web App
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Click Deploy → copy the Web App URL
 *   5. Paste that URL as SCRIPT_URL in index.html
 *
 * Every submission will:
 *   - Append a new row to the Google Sheet (permanent log)
 *   - Send an email notification to TO_EMAIL
 */

const TO_EMAIL = 'thelosthillproject@gmail.com';
const SHEET_NAME = 'Submissions';

// Called by the frontend GET request (most reliable cross-origin approach)
function doGet(e) {
  return processSubmission(e.parameter);
}

// Kept as fallback for direct API / server-side calls
function doPost(e) {
  try {
    return processSubmission(JSON.parse(e.postData.contents));
  } catch (err) {
    return jsonResponse({success: false, error: err.toString()});
  }
}

function processSubmission(data) {
  try {
    // ── Write to Google Sheet ──
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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

    // ── Send email notification ──
    const replyTo = (data.contact || '').includes('@') ? data.contact : '';
    MailApp.sendEmail({
      to: TO_EMAIL,
      subject: 'Purulia 2040 — ' + data.name + ' (' + data.role + ')',
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
    return jsonResponse({success: false, error: err.toString()});
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
