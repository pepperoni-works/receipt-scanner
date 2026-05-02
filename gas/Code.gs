// Google Apps Script - レシートスキャナー（確定申告対応版・画像保存対応）
const SHEET_ID = '1pHP4in7kYs-m2q4tIBqwCZiPKvZhs_OpTR_A5Gy0LQM';
const SHEET_NAME = 'Sheet1';
const SUMMARY_SHEET_NAME = '月別集計';
const DRIVE_FOLDER_NAME = 'レシート画像';
const COLS = 15; // 14列 + 画像URL

// --- Drive画像保存 ---
function getOrCreateFolder() {
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function saveImageToDrive(base64Data, mediaType, fileName) {
  const folder = getOrCreateFolder();
  const decoded = Utilities.base64Decode(base64Data);
  const ext = (mediaType || 'image/jpeg').split('/')[1] || 'jpg';
  const safeName = (fileName || 'receipt').replace(/[\/\\:*?"<>|]/g, '_') + '.' + ext;
  const blob = Utilities.newBlob(decoded, mediaType || 'image/jpeg', safeName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// --- POST ---
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);

    if (data.action === 'delete') return handleDelete(sheet, data);
    if (data.action === 'update') return handleUpdate(sheet, data);

    // ヘッダー行がなければ追加
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        '日付', '店舗名', '金額（税込）', '勘定科目', '税区分', '支払方法',
        'インボイス番号', 'メモ', '経費区分', '按分率', '税抜金額', '消費税額',
        '経費算入額', '登録日時', '画像URL'
      ]);
      sheet.getRange(1, 1, 1, COLS).setFontWeight('bold');
    }

    // 画像がある場合はDriveに保存
    let driveUrl = '';
    if (data.imageBase64) {
      const fileName = data.date + '_' + (data.store || 'receipt') + '_' + (data.amount || 0);
      driveUrl = saveImageToDrive(data.imageBase64, data.imageMediaType || 'image/jpeg', fileName);
    }

    const amt = Number(data.amount) || 0;
    sheet.appendRow([
      data.date, data.store, amt, data.category || '雑費',
      data.taxRate || '', data.payment || '', data.invoice || '',
      data.memo || '', data.expenseType || '事業',
      (Number(data.proration) || 100) + '%',
      Number(data.exTax) || 0, Number(data.tax) || 0,
      Number(data.businessAmount) || amt,
      new Date().toLocaleString('ja-JP'),
      driveUrl
    ]);

    const lr = sheet.getLastRow();
    if (lr > 2) sheet.getRange(2, 1, lr - 1, COLS).sort({ column: 1, ascending: true });
    updateMonthlySummary();

    return ContentService.createTextOutput(JSON.stringify({ success: true, driveUrl: driveUrl })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// --- 行検索ヘルパー ---
function normDate(v) {
  if (v instanceof Date) {
    var y = v.getFullYear(), m = ('0' + (v.getMonth() + 1)).slice(-2), d = ('0' + v.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  var s = String(v), p = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  return p ? p[1] + '-' + ('0' + p[2]).slice(-2) + '-' + ('0' + p[3]).slice(-2) : s;
}

function findRow(sheet, data) {
  const lr = sheet.getLastRow();
  if (lr <= 1) return -1;
  const rows = sheet.getRange(2, 1, lr - 1, COLS).getValues();
  const td = normDate(data.date);
  for (let i = 0; i < rows.length; i++) {
    if (normDate(rows[i][0]) === td && String(rows[i][1]) === String(data.store) && Number(rows[i][2]) === Number(data.amount)) return i + 2;
  }
  return -1;
}

function handleDelete(sheet, data) {
  const row = findRow(sheet, data);
  if (row < 0) return ContentService.createTextOutput(JSON.stringify({ success: false, error: '行が見つかりません' })).setMimeType(ContentService.MimeType.JSON);
  sheet.deleteRow(row);
  updateMonthlySummary();
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

function handleUpdate(sheet, data) {
  const row = findRow(sheet, data);
  if (row < 0) return ContentService.createTextOutput(JSON.stringify({ success: false, error: '行が見つかりません' })).setMimeType(ContentService.MimeType.JSON);
  const u = data.updated, amt = Number(u.amount) || 0;
  // 既存の画像URLを保持
  const existingUrl = sheet.getRange(row, COLS).getValue() || '';
  sheet.getRange(row, 1, 1, COLS).setValues([[
    u.date, u.store, amt, u.category || '雑費', u.taxRate || '', u.payment || '',
    u.invoice || '', u.memo || '', u.expenseType || '事業',
    (Number(u.proration) || 100) + '%',
    Number(u.exTax) || 0, Number(u.tax) || 0, Number(u.businessAmount) || amt,
    data.createdAt, existingUrl
  ]]);
  const lr = sheet.getLastRow();
  if (lr > 2) sheet.getRange(2, 1, lr - 1, COLS).sort({ column: 1, ascending: true });
  updateMonthlySummary();
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

// --- GET ---
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'records';
  try {
    if (action === 'gmail') return handleGmailSearch(e);
    if (action === 'gmail_read') return handleGmailRead(e);
    if (action === 'fetch_url') return handleFetchUrl(e);
    return handleGetRecords();
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function handleGetRecords() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const lr = sheet.getLastRow();
  if (lr <= 1) return ContentService.createTextOutput(JSON.stringify({ success: true, records: [] })).setMimeType(ContentService.MimeType.JSON);
  const cols = Math.max(sheet.getLastColumn(), COLS);
  const data = sheet.getRange(2, 1, lr - 1, cols).getValues();
  const records = data.map(r => ({
    date: r[0], store: r[1], amount: r[2], category: r[3],
    taxRate: r[4], payment: r[5], invoice: r[6], memo: r[7],
    expenseType: r[8], proration: r[9], exTax: r[10], tax: r[11],
    businessAmount: r[12], createdAt: r[13], driveUrl: r[14] || ''
  })).reverse();
  return ContentService.createTextOutput(JSON.stringify({ success: true, records: records })).setMimeType(ContentService.MimeType.JSON);
}

// --- 月別集計 ---
function updateMonthlySummary() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sm = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!sm) sm = ss.insertSheet(SUMMARY_SHEET_NAME);
  sm.clear();
  const ds = ss.getSheetByName(SHEET_NAME);
  const lr = ds.getLastRow();
  if (lr <= 1) return;
  const data = ds.getRange(2, 1, lr - 1, COLS).getValues();
  const monthly = {}, cats = new Set();
  data.forEach(r => {
    const d = String(r[0]), m = d.match(/(\d{4})[\/\-](\d{1,2})/);
    if (!m) return;
    const k = m[1] + '-' + m[2].padStart(2, '0'), c = r[3] || '雑費', ba = Number(r[12]) || 0;
    cats.add(c);
    if (!monthly[k]) monthly[k] = { total: 0, tax: 0, cats: {} };
    monthly[k].total += ba;
    monthly[k].tax += Number(r[11]) || 0;
    monthly[k].cats[c] = (monthly[k].cats[c] || 0) + ba;
  });
  const ms = Object.keys(monthly).sort(), cs = [...cats].sort();
  sm.appendRow(['月', '経費合計', '消費税合計', ...cs]);
  sm.getRange(1, 1, 1, cs.length + 3).setFontWeight('bold');
  ms.forEach(m => {
    const g = monthly[m], [y, mo] = m.split('-');
    const row = [y + '年' + parseInt(mo) + '月', g.total, g.tax];
    cs.forEach(c => row.push(g.cats[c] || 0));
    sm.appendRow(row);
  });
  const tr = ['合計', ms.reduce((s, m) => s + monthly[m].total, 0), ms.reduce((s, m) => s + monthly[m].tax, 0)];
  cs.forEach(c => tr.push(ms.reduce((s, m) => s + (monthly[m].cats[c] || 0), 0)));
  sm.appendRow(tr);
  sm.getRange(sm.getLastRow(), 1, 1, cs.length + 3).setFontWeight('bold');
  if (ms.length > 0) sm.getRange(2, 2, sm.getLastRow() - 1, cs.length + 2).setNumberFormat('#,##0');
}

// --- Gmail ---
function handleGmailSearch(e) {
  const uq = (e.parameter.q || '').trim();
  const days = parseInt(e.parameter.days) || 0;
  const limit = Math.min(parseInt(e.parameter.limit) || 10, 50);
  let query = uq ? uq : '(レシート OR 領収書 OR 注文確認 OR ご利用明細 OR receipt OR order OR invoice OR ご請求 OR 決済完了)';
  if (days > 0) query += ' newer_than:' + days + 'd';
  const threads = GmailApp.search(query, 0, limit);
  const emails = threads.map(t => {
    const m = t.getMessages()[t.getMessageCount() - 1];
    return { id: m.getId(), subject: m.getSubject(), from: m.getFrom(), date: m.getDate().toISOString(), snippet: m.getPlainBody().substring(0, 300) };
  });
  return ContentService.createTextOutput(JSON.stringify({ success: true, emails: emails })).setMimeType(ContentService.MimeType.JSON);
}

function handleGmailRead(e) {
  const msg = GmailApp.getMessageById(e.parameter.id);
  return ContentService.createTextOutput(JSON.stringify({
    success: true, subject: msg.getSubject(), from: msg.getFrom(),
    date: msg.getDate().toISOString(), body: msg.getPlainBody().substring(0, 5000)
  })).setMimeType(ContentService.MimeType.JSON);
}

// --- URL取得 ---
function handleFetchUrl(e) {
  const url = e.parameter.url;
  if (!url) throw new Error('URLが必要です');
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const html = res.getContentText();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return ContentService.createTextOutput(JSON.stringify({ success: true, text: text.substring(0, 5000) })).setMimeType(ContentService.MimeType.JSON);
}
