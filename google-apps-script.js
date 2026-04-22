/**
 * Purulia 2040 — Form Handler
 * Google Apps Script — deploys as a web app endpoint
 */

const TO_EMAIL       = 'thelosthillproject@gmail.com';
const SHEET_NAME     = 'Submissions';
const SPREADSHEET_ID = '17HN5pN74XgCreHRNgUDMdj2A6-RldS3ID-4WoIpeZDQ';

// ── Handlers ─────────────────────────────────────────────────────────────────

function doGet(e) {
  // If the website asks for the live messages feed, run the fetch function
  if (e.parameter && e.parameter.action === 'getMessages') {
    return getMessagesJSON();
  }
  // Otherwise, fall back to processing a normal submission
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

// ── Fetch Live Messages Logic ─────────────────────────────────────────────────

function getMessagesJSON() {
  try {
    const ss = openSheet();
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    }

    // Skip the header row
    const rows = data.slice(1);

    // Map the rows into objects, STRICTLY EXCLUDING the contact info (row[5]) for privacy
    let messages = rows.map(row => {
      return {
        timestamp: row[0],
        name: row[1],
        role: row[2],
        location: row[3],
        message: row[4]
      };
    });

    // Filter out empty messages and reverse the array to show latest first
    messages = messages.filter(m => m.message && m.message.trim() !== '' && m.message !== '(none)').reverse();

    return ContentService.createTextOutput(JSON.stringify(messages)).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('getMessages error: ' + err);
    return ContentService.createTextOutput(JSON.stringify({error: err.toString()})).setMimeType(ContentService.MimeType.JSON);
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
