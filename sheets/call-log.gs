/**
 * Call log receiver for all three demos (free, no Google Cloud project needed).
 *
 * Setup:
 * 1. Create a Google Sheet named "Voice Agent Call Log".
 * 2. Extensions > Apps Script, paste this file, save.
 * 3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 4. Copy the /exec URL into the Worker secret SHEETS_WEBHOOK_URL.
 *
 * Each demo gets its own tab. The Worker picks the tab name (row.sheet, from SHEET_TAB_DEMO1..3,
 * default demo1 / demo2 / demo3). Missing tabs are created; empty tabs get a header row on first write.
 * A screenshot of this sheet is a portfolio asset: it shows every call turned into a structured record.
 */
const COLUMNS = ["timestamp", "demo", "platform", "event", "caller", "details", "summary", "durationSec", "recordingUrl", "callId"];

function doPost(e) {
  const row = JSON.parse(e.postData.contents);
  const tabName = String(row.sheet || String(row.demo || "log").split(":")[0]);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  if (sheet.getLastRow() === 0) addHeader_(sheet);
  sheet.appendRow(COLUMNS.map((c) => row[c] ?? ""));
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function addHeader_(sheet) {
  sheet.appendRow(COLUMNS);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight("bold");
  return sheet;
}
