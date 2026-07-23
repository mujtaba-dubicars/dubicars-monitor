/**
 * DubiCars Monitor — Google Sheets sink.
 *
 * Paste this into the sheet's Apps Script editor (Extensions -> Apps Script),
 * then deploy as a Web App (Execute as: Me, Who has access: Anyone).
 * The monitor POSTs JSON; this appends rows, auto-creating tabs + headers.
 *
 * Payload shape:
 * {
 *   "secret": "optional-shared-secret",
 *   "sheets": {
 *     "API_Log":       { "headers": [...], "rows": [[...], ...] },
 *     "Journey_Log":   { "headers": [...], "rows": [[...], ...] },
 *     "Network_Errors":{ "headers": [...], "rows": [[...], ...] }
 *   }
 * }
 *
 * Optional: to require a shared secret, set a Script Property named SECRET
 * (Project Settings -> Script Properties) and send the same value as "secret".
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    var expected = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (expected && body.secret !== expected) {
      return json({ ok: false, error: 'unauthorized' });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var appended = {};
    var sheets = body.sheets || {};

    Object.keys(sheets).forEach(function (name) {
      var spec = sheets[name] || {};
      var sheet = ss.getSheetByName(name);
      if (!sheet) {
        sheet = ss.insertSheet(name);
        if (spec.headers && spec.headers.length) sheet.appendRow(spec.headers);
      } else if (sheet.getLastRow() === 0 && spec.headers && spec.headers.length) {
        sheet.appendRow(spec.headers);
      }
      var rows = spec.rows || [];
      if (rows.length) {
        sheet
          .getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
          .setValues(rows);
      }
      appended[name] = rows.length;
    });

    return json({ ok: true, appended: appended });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
