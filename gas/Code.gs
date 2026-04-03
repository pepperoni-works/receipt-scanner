// Google Apps Script - レシートスキャナー（確定申告対応版）
const SHEET_ID = '1pHP4in7kYs-m2q4tIBqwCZiPKvZhs_OpTR_A5Gy0LQM';
const SHEET_NAME = 'Sheet1';
const SUMMARY_SHEET_NAME = '月別集計';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);

    // 削除アクション
    if (data.action === 'delete') {
      return handleDelete(sheet, data);
    }

    // 更新アクション
    if (data.action === 'update') {
      return handleUpdate(sheet, data);
    }

    // ヘッダー行がなければ追加
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        '日付', '店舗名', '金額（税込）', '勘定科目', '税区分', '支払方法',
        'インボイス番号', 'メモ', '経費区分', '按分率', '税抜金額', '消費税額',
        '経費算入額', '登録日時'
      ]);
      // ヘッダー行を太字に
      sheet.getRange(1, 1, 1, 14).setFontWeight('bold');
    }

    const amount = Number(data.amount) || 0;
    const proration = Number(data.proration) || 100;
    const exTax = Number(data.exTax) || 0;
    const tax = Number(data.tax) || 0;
    const businessAmount = Number(data.businessAmount) || amount;

    sheet.appendRow([
      data.date,
      data.store,
      amount,
      data.category || '雑費',
      data.taxRate || '',
      data.payment || '',
      data.invoice || '',
      data.memo || '',
      data.expenseType || '事業',
      proration + '%',
      exTax,
      tax,
      businessAmount,
      new Date().toLocaleString('ja-JP')
    ]);

    // 日付順にソート（ヘッダー除く）
    const lastRow = sheet.getLastRow();
    if (lastRow > 2) {
      sheet.getRange(2, 1, lastRow - 1, 14).sort({ column: 1, ascending: true });
    }

    // 月別集計シートを更新
    updateMonthlySummary();

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 行を特定するヘルパー（日付+店舗名+金額+登録日時で一致）
function findRow(sheet, data) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  const rows = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) === String(data.date) &&
        String(r[1]) === String(data.store) &&
        Number(r[2]) === Number(data.amount) &&
        String(r[13]) === String(data.createdAt)) {
      return i + 2; // 1-indexed + header
    }
  }
  return -1;
}

function handleDelete(sheet, data) {
  const row = findRow(sheet, data);
  if (row < 0) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: '該当行が見つかりません' })).setMimeType(ContentService.MimeType.JSON);
  }
  sheet.deleteRow(row);
  updateMonthlySummary();
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

function handleUpdate(sheet, data) {
  const row = findRow(sheet, data);
  if (row < 0) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: '該当行が見つかりません' })).setMimeType(ContentService.MimeType.JSON);
  }
  const u = data.updated;
  const amount = Number(u.amount) || 0;
  const proration = Number(u.proration) || 100;
  const exTax = Number(u.exTax) || 0;
  const tax = Number(u.tax) || 0;
  const businessAmount = Number(u.businessAmount) || amount;

  sheet.getRange(row, 1, 1, 14).setValues([[
    u.date, u.store, amount, u.category || '雑費', u.taxRate || '', u.payment || '',
    u.invoice || '', u.memo || '', u.expenseType || '事業', proration + '%',
    exTax, tax, businessAmount, data.createdAt
  ]]);

  const lastRow = sheet.getLastRow();
  if (lastRow > 2) {
    sheet.getRange(2, 1, lastRow - 1, 14).sort({ column: 1, ascending: true });
  }
  updateMonthlySummary();
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'records';
  try {
    if (action === 'gmail') return handleGmailSearch(e);
    if (action === 'gmail_read') return handleGmailRead(e);
    if (action === 'fetch_url') return handleFetchUrl(e);
    return handleGetRecords();
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleGetRecords() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return ContentService.createTextOutput(JSON.stringify({ success: true, records: [] })).setMimeType(ContentService.MimeType.JSON);

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  const records = data.map(row => ({
    date: row[0], store: row[1], amount: row[2], category: row[3],
    taxRate: row[4], payment: row[5], invoice: row[6], memo: row[7],
    expenseType: row[8], proration: row[9], exTax: row[10], tax: row[11],
    businessAmount: row[12], createdAt: row[13]
  })).reverse();

  return ContentService.createTextOutput(JSON.stringify({ success: true, records: records })).setMimeType(ContentService.MimeType.JSON);
}

// 月別集計シートを自動生成・更新
function updateMonthlySummary() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!summarySheet) {
    summarySheet = ss.insertSheet(SUMMARY_SHEET_NAME);
  }
  summarySheet.clear();

  const dataSheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = dataSheet.getLastRow();
  if (lastRow <= 1) return;

  const data = dataSheet.getRange(2, 1, lastRow - 1, 14).getValues();

  // 月別 × 勘定科目で集計
  const monthly = {};
  const allCategories = new Set();

  data.forEach(row => {
    const dateStr = String(row[0]);
    const match = dateStr.match(/(\d{4})[\/\-](\d{1,2})/);
    if (!match) return;
    const monthKey = match[1] + '-' + match[2].padStart(2, '0');
    const category = row[3] || '雑費';
    const businessAmount = Number(row[12]) || 0;

    allCategories.add(category);
    if (!monthly[monthKey]) monthly[monthKey] = { total: 0, tax: 0, categories: {} };
    monthly[monthKey].total += businessAmount;
    monthly[monthKey].tax += Number(row[11]) || 0;
    monthly[monthKey].categories[category] = (monthly[monthKey].categories[category] || 0) + businessAmount;
  });

  const months = Object.keys(monthly).sort();
  const categories = [...allCategories].sort();

  // ヘッダー
  const header = ['月', '経費合計', '消費税合計', ...categories];
  summarySheet.appendRow(header);
  summarySheet.getRange(1, 1, 1, header.length).setFontWeight('bold');

  // 各月データ
  let grandTotal = 0;
  let grandTax = 0;
  months.forEach(m => {
    const g = monthly[m];
    const [y, mo] = m.split('-');
    const row = [`${y}年${parseInt(mo)}月`, g.total, g.tax];
    categories.forEach(cat => row.push(g.categories[cat] || 0));
    summarySheet.appendRow(row);
    grandTotal += g.total;
    grandTax += g.tax;
  });

  // 合計行
  const totalRow = ['合計', grandTotal, grandTax];
  categories.forEach(cat => {
    totalRow.push(months.reduce((s, m) => s + (monthly[m].categories[cat] || 0), 0));
  });
  summarySheet.appendRow(totalRow);
  const lastSummaryRow = summarySheet.getLastRow();
  summarySheet.getRange(lastSummaryRow, 1, 1, header.length).setFontWeight('bold');

  // 金額列のフォーマット
  if (months.length > 0) {
    summarySheet.getRange(2, 2, lastSummaryRow - 1, header.length - 1).setNumberFormat('#,##0');
  }
}

// Gmail検索
function handleGmailSearch(e) {
  const uq = (e.parameter.q || '').trim();
  const query = uq ? uq : '(レシート OR 領収書 OR 注文確認 OR ご利用明細 OR receipt OR order)';
  const threads = GmailApp.search(query, 0, 10);
  const emails = threads.map(t => {
    const m = t.getMessages()[t.getMessageCount() - 1];
    return { id: m.getId(), subject: m.getSubject(), from: m.getFrom(), date: m.getDate().toISOString(), snippet: m.getPlainBody().substring(0, 150) };
  });
  return ContentService.createTextOutput(JSON.stringify({ success: true, emails: emails })).setMimeType(ContentService.MimeType.JSON);
}

// Gmail本文取得
function handleGmailRead(e) {
  const msg = GmailApp.getMessageById(e.parameter.id);
  return ContentService.createTextOutput(JSON.stringify({
    success: true, subject: msg.getSubject(), from: msg.getFrom(),
    date: msg.getDate().toISOString(), body: msg.getPlainBody().substring(0, 5000)
  })).setMimeType(ContentService.MimeType.JSON);
}

// URL取得（CORSプロキシ）
function handleFetchUrl(e) {
  const url = e.parameter.url;
  if (!url) throw new Error('URLが必要です');
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const html = res.getContentText();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return ContentService.createTextOutput(JSON.stringify({ success: true, text: text.substring(0, 5000) })).setMimeType(ContentService.MimeType.JSON);
}
