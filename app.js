// --- Dark Mode ---
const themeToggleBtn = document.getElementById('themeToggleBtn');
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('receipt_theme', theme);
  themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
(function initTheme() {
  const saved = localStorage.getItem('receipt_theme');
  if (saved) { applyTheme(saved); }
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) { applyTheme('dark'); }
})();
themeToggleBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// --- DOM Elements ---
const dropZone = document.getElementById('dropZone');
const cameraInput = document.getElementById('cameraInput');
const fileInput = document.getElementById('fileInput');
const uploadSection = document.getElementById('uploadSection');
const previewSection = document.getElementById('previewSection');
const previewImage = document.getElementById('previewImage');
const removeImageBtn = document.getElementById('removeImageBtn');
const analyzingIndicator = document.getElementById('analyzingIndicator');
const editSection = document.getElementById('editSection');
const receiptForm = document.getElementById('receiptForm');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const savingOverlay = document.getElementById('savingOverlay');
const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const toastContainer = document.getElementById('toastContainer');
const apiKeyInput = document.getElementById('apiKeyInput');
const gasUrlInput = document.getElementById('gasUrlInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');

// Form fields
const storeInput = document.getElementById('storeInput');
const dateInput = document.getElementById('dateInput');
const amountInput = document.getElementById('amountInput');
const categorySelect = document.getElementById('categorySelect');
const memoInput = document.getElementById('memoInput');

// --- State ---
let currentBase64 = null;
let currentMediaType = null;
const history = [];

// --- Settings ---
const sheetUrlInput = document.getElementById('sheetUrlInput');

function loadSettings() {
  apiKeyInput.value = localStorage.getItem('receipt_api_key') || '';
  gasUrlInput.value = localStorage.getItem('receipt_gas_url') || '';
  sheetUrlInput.value = localStorage.getItem('receipt_sheet_url') || '';
}

function saveSettings() {
  localStorage.setItem('receipt_api_key', apiKeyInput.value.trim());
  localStorage.setItem('receipt_gas_url', gasUrlInput.value.trim());
  localStorage.setItem('receipt_sheet_url', sheetUrlInput.value.trim());
  showToast('設定を保存しました', 'success');
  updateSheetLink();
  if (getGasUrl()) fetchAllHistory();
}

function getApiKey() {
  return localStorage.getItem('receipt_api_key') || '';
}

function getGasUrl() {
  return localStorage.getItem('receipt_gas_url') || '';
}

// 旧ボタンの互換性（削除済み）
// saveSettingsBtn.addEventListener('click', saveSettings);
openSettingsBtn.addEventListener('click', () => { settingsModal.classList.remove('hidden'); updateQR(); });
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.add('hidden');
});
loadSettings();

// --- Settings sharing via URL hash ---
// URLに#config=...が付いていたら設定を復元
function importSettingsFromUrl() {
  const hash = window.location.hash;
  if (!hash.startsWith('#cfg=') && !hash.startsWith('#config=')) return false;
  try {
    let json;
    if (hash.startsWith('#cfg=')) {
      json = decodeURIComponent(escape(atob(hash.slice('#cfg='.length))));
    } else {
      json = decodeURIComponent(hash.slice('#config='.length));
    }
    const cfg = JSON.parse(json);
    if (cfg.apiKey) { localStorage.setItem('receipt_api_key', cfg.apiKey); apiKeyInput.value = cfg.apiKey; }
    if (cfg.gasUrl) { localStorage.setItem('receipt_gas_url', cfg.gasUrl); gasUrlInput.value = cfg.gasUrl; }
    if (cfg.sheetUrl) { localStorage.setItem('receipt_sheet_url', cfg.sheetUrl); sheetUrlInput.value = cfg.sheetUrl; }
    // ハッシュをクリア（APIキーをURL履歴に残さない）
    window.history.replaceState(null, '', window.location.pathname);
    // 自動保存＆履歴読み込み
    updateSheetLink();
    if (getGasUrl()) fetchAllHistory();
    settingsModal.classList.add('hidden');
    showToast('設定を自動読み込みしました', 'success');
    return true;
  } catch { return false; }
}
const imported = importSettingsFromUrl();

// QRコード生成（設定モーダル開くたびに自動更新）
const qrContainer = document.getElementById('qrContainer');

function updateQR() {
  if (typeof qrcode === 'undefined') return;
  const cfg = {
    apiKey: getApiKey(),
    gasUrl: getGasUrl(),
    sheetUrl: localStorage.getItem('receipt_sheet_url') || ''
  };
  let base = 'https://pepperoni-works.github.io/receipt-scanner/';
  const shareUrl = base + '#cfg=' + btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
  try {
    const qr = qrcode(0, 'L');
    qr.addData(shareUrl);
    qr.make();
    qrContainer.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2 });
  } catch {}
}

// --- Save & Connection Check ---
const saveAndCheckBtn = document.getElementById('saveAndCheckBtn');
const checkResults = document.getElementById('checkResults');

function checkItemHtml(id, label, status, detail) {
  const icons = { loading: '<span class="check-spinner"></span>', ok: '&#10003;', ng: '&#10007;' };
  return `<div class="check-item ${status}" id="check-${id}">
    <span class="check-icon">${icons[status]}</span>
    <span>${label}${detail ? ' — ' + detail : ''}</span>
  </div>`;
}

function renderChecks(items) {
  checkResults.innerHTML = items.map(i => checkItemHtml(i.id, i.label, i.status, i.detail)).join('');
  checkResults.classList.remove('hidden');
}

saveAndCheckBtn.addEventListener('click', async () => {
  // まず保存
  saveSettings();
  // 接続チェック開始
  saveAndCheckBtn.disabled = true;
  saveAndCheckBtn.textContent = 'チェック中...';

  const checks = [
    { id: 'apikey', label: 'Anthropic API Key', status: 'loading', detail: '' },
    { id: 'gas', label: 'Google Apps Script', status: 'loading', detail: '' },
  ];
  renderChecks(checks);

  // 1. API Key チェック
  const apiKey = getApiKey();
  if (!apiKey) {
    checks[0] = { ...checks[0], status: 'ng', detail: '未入力' };
  } else {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }]
        })
      });
      if (res.ok) {
        checks[0] = { ...checks[0], status: 'ok', detail: '接続OK' };
      } else {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) {
          checks[0] = { ...checks[0], status: 'ng', detail: 'APIキーが無効です' };
        } else {
          checks[0] = { ...checks[0], status: 'ok', detail: '認証OK（' + res.status + '）' };
        }
      }
    } catch (err) {
      checks[0] = { ...checks[0], status: 'ng', detail: '接続エラー' };
    }
  }
  renderChecks(checks);

  // 2. GAS URL チェック
  const gasUrl = getGasUrl();
  if (!gasUrl) {
    checks[1] = { ...checks[1], status: 'ng', detail: '未入力' };
  } else {
    try {
      // まずCORS対応のfetchを試す
      const res = await fetch(gasUrl, { redirect: 'follow' });
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        const count = data.records ? data.records.length : 0;
        checks[1] = { ...checks[1], status: 'ok', detail: `接続OK（${count}件の記録）` };
      } catch {
        // JSONでなくてもレスポンスがあればOK（テキスト応答など）
        if (text && !text.includes('スクリプト関数が見つかりません')) {
          checks[1] = { ...checks[1], status: 'ok', detail: '接続OK' };
        } else {
          checks[1] = { ...checks[1], status: 'ng', detail: 'GASにdoGet関数がありません。再デプロイしてください' };
        }
      }
    } catch (err) {
      // CORSエラーの場合はno-corsで到達確認
      try {
        await fetch(gasUrl, { mode: 'no-cors' });
        checks[1] = { ...checks[1], status: 'ok', detail: '接続OK（CORS制限のため詳細は取得不可）' };
      } catch {
        checks[1] = { ...checks[1], status: 'ng', detail: '接続できません。URLを確認してください' };
      }
    }
  }
  renderChecks(checks);

  saveAndCheckBtn.disabled = false;
  saveAndCheckBtn.textContent = '保存して接続チェック';
});

// --- GAS Code Display ---
const GAS_CODE = `// 確定申告対応版（編集・削除・画像保存対応）
const SHEET_ID = 'ここにスプレッドシートIDを貼り付け';
const SHEET_NAME = 'Sheet1';
const SUMMARY_SHEET_NAME = '月別集計';
const DRIVE_FOLDER_NAME = 'レシート画像';
const COLS = 15;
function getOrCreateFolder(){const f=DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);if(f.hasNext())return f.next();return DriveApp.createFolder(DRIVE_FOLDER_NAME);}
function saveImageToDrive(b64,type,name){const f=getOrCreateFolder(),d=Utilities.base64Decode(b64),ext=(type||'image/jpeg').split('/')[1]||'jpg',safe=(name||'receipt').replace(/[\\/\\\\:*?"<>|]/g,'_')+'.'+ext;const blob=Utilities.newBlob(d,type||'image/jpeg',safe),file=f.createFile(blob);file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);return file.getUrl();}
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (data.action==='delete') return handleDelete(sheet,data);
    if (data.action==='update') return handleUpdate(sheet,data);
    if (sheet.getLastRow()===0) {
      sheet.appendRow(['日付','店舗名','金額（税込）','勘定科目','税区分','支払方法','インボイス番号','メモ','経費区分','按分率','税抜金額','消費税額','経費算入額','登録日時','画像URL']);
      sheet.getRange(1,1,1,COLS).setFontWeight('bold');
    }
    let driveUrl='';
    if(data.imageBase64){const fn=data.date+'_'+(data.store||'receipt')+'_'+(data.amount||0);driveUrl=saveImageToDrive(data.imageBase64,data.imageMediaType||'image/jpeg',fn);}
    const amt=Number(data.amount)||0;
    sheet.appendRow([data.date,data.store,amt,data.category||'雑費',data.taxRate||'',data.payment||'',data.invoice||'',data.memo||'',data.expenseType||'事業',(Number(data.proration)||100)+'%',Number(data.exTax)||0,Number(data.tax)||0,Number(data.businessAmount)||amt,new Date().toLocaleString('ja-JP'),driveUrl]);
    const lr=sheet.getLastRow();if(lr>2)sheet.getRange(2,1,lr-1,COLS).sort({column:1,ascending:true});
    updateMonthlySummary();
    return ContentService.createTextOutput(JSON.stringify({success:true,driveUrl:driveUrl})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({success:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}
function normDate(v){if(v instanceof Date){var y=v.getFullYear(),m=('0'+(v.getMonth()+1)).slice(-2),d=('0'+v.getDate()).slice(-2);return y+'-'+m+'-'+d;}var s=String(v),p=s.match(/(\\d{4})[\\/-](\\d{1,2})[\\/-](\\d{1,2})/);return p?p[1]+'-'+('0'+p[2]).slice(-2)+'-'+('0'+p[3]).slice(-2):s;}
function findRow(sheet,data){const lr=sheet.getLastRow();if(lr<=1)return -1;const rows=sheet.getRange(2,1,lr-1,COLS).getValues();const td=normDate(data.date);for(let i=0;i<rows.length;i++){if(normDate(rows[i][0])===td&&String(rows[i][1])===String(data.store)&&Number(rows[i][2])===Number(data.amount))return i+2;}return -1;}
function handleDelete(sheet,data){const row=findRow(sheet,data);if(row<0)return ContentService.createTextOutput(JSON.stringify({success:false,error:'行が見つかりません'})).setMimeType(ContentService.MimeType.JSON);sheet.deleteRow(row);updateMonthlySummary();return ContentService.createTextOutput(JSON.stringify({success:true})).setMimeType(ContentService.MimeType.JSON);}
function handleUpdate(sheet,data){const row=findRow(sheet,data);if(row<0)return ContentService.createTextOutput(JSON.stringify({success:false,error:'行が見つかりません'})).setMimeType(ContentService.MimeType.JSON);const u=data.updated,amt=Number(u.amount)||0;const eu=sheet.getRange(row,COLS).getValue()||'';sheet.getRange(row,1,1,COLS).setValues([[u.date,u.store,amt,u.category||'雑費',u.taxRate||'',u.payment||'',u.invoice||'',u.memo||'',u.expenseType||'事業',(Number(u.proration)||100)+'%',Number(u.exTax)||0,Number(u.tax)||0,Number(u.businessAmount)||amt,data.createdAt,eu]]);const lr=sheet.getLastRow();if(lr>2)sheet.getRange(2,1,lr-1,COLS).sort({column:1,ascending:true});updateMonthlySummary();return ContentService.createTextOutput(JSON.stringify({success:true})).setMimeType(ContentService.MimeType.JSON);}
function doGet(e) {
  const action=(e&&e.parameter&&e.parameter.action)||'records';
  try {
    if(action==='gmail') return handleGmailSearch(e);
    if(action==='gmail_read') return handleGmailRead(e);
    if(action==='fetch_url') return handleFetchUrl(e);
    return handleGetRecords();
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({success:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}
function handleGetRecords() {
  const sheet=SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);const lr=sheet.getLastRow();
  if(lr<=1) return ContentService.createTextOutput(JSON.stringify({success:true,records:[]})).setMimeType(ContentService.MimeType.JSON);
  const cols=Math.max(sheet.getLastColumn(),COLS),data=sheet.getRange(2,1,lr-1,cols).getValues();
  const records=data.map(r=>({date:r[0],store:r[1],amount:r[2],category:r[3],taxRate:r[4],payment:r[5],invoice:r[6],memo:r[7],expenseType:r[8],proration:r[9],exTax:r[10],tax:r[11],businessAmount:r[12],createdAt:r[13],driveUrl:r[14]||''})).reverse();
  return ContentService.createTextOutput(JSON.stringify({success:true,records:records})).setMimeType(ContentService.MimeType.JSON);
}
function updateMonthlySummary() {
  const ss=SpreadsheetApp.openById(SHEET_ID);let sm=ss.getSheetByName(SUMMARY_SHEET_NAME);if(!sm)sm=ss.insertSheet(SUMMARY_SHEET_NAME);sm.clear();
  const ds=ss.getSheetByName(SHEET_NAME);const lr=ds.getLastRow();if(lr<=1)return;
  const data=ds.getRange(2,1,lr-1,COLS).getValues();const monthly={},cats=new Set();
  data.forEach(r=>{const d=String(r[0]),m=d.match(/(\\d{4})[\\/-](\\d{1,2})/);if(!m)return;const k=m[1]+'-'+m[2].padStart(2,'0'),c=r[3]||'雑費',ba=Number(r[12])||0;cats.add(c);if(!monthly[k])monthly[k]={total:0,tax:0,cats:{}};monthly[k].total+=ba;monthly[k].tax+=Number(r[11])||0;monthly[k].cats[c]=(monthly[k].cats[c]||0)+ba;});
  const ms=Object.keys(monthly).sort(),cs=[...cats].sort();
  sm.appendRow(['月','経費合計','消費税合計',...cs]);sm.getRange(1,1,1,cs.length+3).setFontWeight('bold');
  ms.forEach(m=>{const g=monthly[m],[y,mo]=m.split('-');const row=[y+'年'+parseInt(mo)+'月',g.total,g.tax];cs.forEach(c=>row.push(g.cats[c]||0));sm.appendRow(row);});
  const tr=['合計',ms.reduce((s,m)=>s+monthly[m].total,0),ms.reduce((s,m)=>s+monthly[m].tax,0)];cs.forEach(c=>tr.push(ms.reduce((s,m)=>s+(monthly[m].cats[c]||0),0)));sm.appendRow(tr);
  sm.getRange(sm.getLastRow(),1,1,cs.length+3).setFontWeight('bold');
  if(ms.length>0)sm.getRange(2,2,sm.getLastRow()-1,cs.length+2).setNumberFormat('#,##0');
}
function handleGmailSearch(e) {
  const uq=(e.parameter.q||'').trim();const days=parseInt(e.parameter.days)||0;
  const after=(e.parameter.after||'').trim();const before=(e.parameter.before||'').trim();
  const limit=Math.min(parseInt(e.parameter.limit)||10,100);
  let query=uq?uq:'(レシート OR 領収書 OR 注文 OR 購入 OR ご利用 OR ご請求 OR お支払い OR 決済 OR 引き落とし OR お買い上げ OR 確認 OR 完了 OR receipt OR order OR invoice OR purchase OR payment OR billing OR subscription OR confirmation)';
  if(days>0)query+=' newer_than:'+days+'d';
  if(after)query+=' after:'+after.replace(/-/g,'/');
  if(before)query+=' before:'+before.replace(/-/g,'/');
  const threads=GmailApp.search(query,0,limit);
  const emails=threads.map(t=>{const m=t.getMessages()[t.getMessageCount()-1];return{id:m.getId(),subject:m.getSubject(),from:m.getFrom(),date:m.getDate().toISOString(),snippet:m.getPlainBody().substring(0,300)};});
  return ContentService.createTextOutput(JSON.stringify({success:true,emails:emails})).setMimeType(ContentService.MimeType.JSON);
}
function handleGmailRead(e) {
  const msg=GmailApp.getMessageById(e.parameter.id);
  return ContentService.createTextOutput(JSON.stringify({success:true,subject:msg.getSubject(),from:msg.getFrom(),date:msg.getDate().toISOString(),body:msg.getPlainBody().substring(0,5000)})).setMimeType(ContentService.MimeType.JSON);
}
function handleFetchUrl(e) {
  const url=e.parameter.url;if(!url)throw new Error('URLが必要です');
  const res=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:true});const html=res.getContentText();
  const text=html.replace(/<script[\\s\\S]*?<\\/script>/gi,'').replace(/<style[\\s\\S]*?<\\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').trim();
  return ContentService.createTextOutput(JSON.stringify({success:true,text:text.substring(0,5000)})).setMimeType(ContentService.MimeType.JSON);
}`;

const gasCodeEl = document.getElementById('gasCode');
const copyGasCodeBtn = document.getElementById('copyGasCodeBtn');

// スプレッドシートURLからIDを抽出
function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : '';
}

// IDをGASコードに埋め込んで表示を更新
function getGasCodeWithId() {
  const sheetUrl = sheetUrlInput.value.trim();
  const sheetId = extractSheetId(sheetUrl);
  if (sheetId) {
    return GAS_CODE.replace("'ここにスプレッドシートIDを貼り付け'", `'${sheetId}'`);
  }
  return GAS_CODE;
}

function updateGasCodeDisplay() {
  if (gasCodeEl) gasCodeEl.textContent = getGasCodeWithId();
}

updateGasCodeDisplay();

// スプレッドシートURL入力時にリアルタイムでGASコード更新
if (sheetUrlInput) {
  sheetUrlInput.addEventListener('input', updateGasCodeDisplay);
}

if (copyGasCodeBtn) {
  copyGasCodeBtn.addEventListener('click', async () => {
    const code = getGasCodeWithId();
    let copied = false;

    // 1. Clipboard API（HTTPS環境）
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
      } catch {}
    }

    // 2. execCommand フォールバック
    if (!copied) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.setAttribute('readonly', '');
        textarea.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {}
    }

    // 3. 最終フォールバック：コードを選択状態にする
    if (!copied) {
      const range = document.createRange();
      range.selectNodeContents(gasCodeEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      showToast('コードを選択しました。Cmd+Cでコピーしてください', 'success');
      return;
    }

    copyGasCodeBtn.textContent = 'コピー済み';
    setTimeout(() => { copyGasCodeBtn.textContent = 'コピー'; }, 2000);
  });
}

// Open settings if API key is not set (unless imported from QR)
if (!getApiKey() && !imported) {
  settingsModal.classList.remove('hidden');
  setTimeout(updateQR, 100);
}

// --- Toast ---
function showToast(message, type = 'success') {
  // 既存のトーストをすべて消す（最新1個だけ表示）
  toastContainer.innerHTML = '';
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.addEventListener('click', () => toast.remove());
  toastContainer.appendChild(toast);
  // 3秒で自動消去
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}

// --- Unified Input Switching ---
const inputMain = document.getElementById('inputMain');
const inputAlt = document.getElementById('inputAlt');
const inputBackBtn = document.getElementById('inputBackBtn');
const inputAltTitle = document.getElementById('inputAltTitle');
const altPanels = document.querySelectorAll('.alt-panel');
const modeTitles = { csv: 'CSV一括取込', gmail: 'Gmail', url: 'URL', text: 'テキスト' };

document.querySelectorAll('.secondary-action-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    inputMain.classList.add('hidden');
    inputAlt.classList.remove('hidden');
    inputAltTitle.textContent = modeTitles[mode] || mode;
    altPanels.forEach(p => p.classList.toggle('active', p.id === 'alt' + mode.charAt(0).toUpperCase() + mode.slice(1)));
  });
});

inputBackBtn.addEventListener('click', () => {
  inputAlt.classList.add('hidden');
  inputMain.classList.remove('hidden');
});

// --- Text Receipt Analysis ---
const textReceiptInput = document.getElementById('textReceiptInput');
const analyzeTextBtn = document.getElementById('analyzeTextBtn');

analyzeTextBtn.addEventListener('click', () => analyzeText());

async function analyzeText() {
  const text = textReceiptInput.value.trim();
  if (!text) { showToast('テキストを入力してください', 'error'); return; }

  const apiKey = getApiKey();
  if (!apiKey) { showToast('API Keyを設定してください', 'error'); settingsModal.classList.remove('hidden'); return; }

  uploadSection.classList.add('hidden');
  previewSection.classList.remove('hidden');
  analyzingIndicator.classList.remove('hidden');
  analyzingIndicator.querySelector('p').textContent = 'AIが解析中...';

  const today = new Date().toISOString().split('T')[0];

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `以下のレシート・領収書・注文確認メールのテキストから情報を抽出してください。JSON形式のみで返答してください（前置き・後書きなし）:
{
  "store": "店舗名・サービス名",
  "date": "YYYY-MM-DD形式の日付（不明な場合は${today}）",
  "amount": 数値（税込合計金額、数値のみ）,
  "category": "勘定科目（消耗品費/旅費交通費/通信費/接待交際費/会議費/新聞図書費/地代家賃/水道光熱費/外注工賃/広告宣伝費/福利厚生費/雑費/その他）",
  "taxRate": "税率（10%/8%/混在/不明）",
  "payment": "支払方法（現金/クレジットカード/電子マネー/QRコード決済/その他/不明）",
  "invoice": "インボイス登録番号（T+13桁、あれば）",
  "memo": "特記事項"
}

テキスト:
${text}`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();
    const respText = data.content[0].text.trim();
    const jsonMatch = respText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSONを抽出できませんでした');

    const result = JSON.parse(jsonMatch[0]);
    populateForm(result);
    textReceiptInput.value = '';
  } catch (err) {
    console.error('テキスト解析エラー:', err);
    showToast(`解析失敗: ${err.message}`, 'error');
    resetToUpload();
  } finally {
    analyzingIndicator.classList.add('hidden');
  }
}

// --- PDF Analysis ---
function isPdf(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

async function handlePdf(file) {
  const apiKey = getApiKey();
  if (!apiKey) { showToast('API Keyを設定してください', 'error'); settingsModal.classList.remove('hidden'); return; }

  uploadSection.classList.add('hidden');
  previewSection.classList.remove('hidden');
  analyzingIndicator.classList.remove('hidden');
  analyzingIndicator.querySelector('p').textContent = 'PDFを読み込み中...';

  try {
    const arrayBuffer = await file.arrayBuffer();

    if (typeof pdfjsLib === 'undefined') throw new Error('PDFライブラリの読み込みに失敗しました');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 10);

    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    fullText = fullText.trim();
    if (!fullText) throw new Error('PDFからテキストを抽出できませんでした');

    analyzingIndicator.querySelector('p').textContent = 'AIが解析中...';

    const today = new Date().toISOString().split('T')[0];
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `以下のPDFから抽出したテキストはレシート・領収書・請求書です。情報を抽出してください。JSON形式のみで返答（前置き・後書きなし）:
{
  "store": "店舗名・サービス名",
  "date": "YYYY-MM-DD形式の日付（不明な場合は${today}）",
  "amount": 数値（税込合計金額、数値のみ）,
  "category": "勘定科目（消耗品費/旅費交通費/通信費/接待交際費/会議費/新聞図書費/地代家賃/水道光熱費/外注工賃/広告宣伝費/福利厚生費/雑費/その他）",
  "taxRate": "税率（10%/8%/混在/不明）",
  "payment": "支払方法（現金/クレジットカード/電子マネー/QRコード決済/その他/不明）",
  "invoice": "インボイス登録番号（T+13桁、あれば）",
  "memo": "特記事項"
}

PDFテキスト:
${fullText.substring(0, 4000)}`
        }]
      })
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    const aiData = await response.json();
    const respText = aiData.content[0].text.trim();
    const jsonMatch = respText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSONを抽出できませんでした');

    populateForm(JSON.parse(jsonMatch[0]));
    pdfInput.value = '';
  } catch (err) {
    console.error('PDF解析エラー:', err);
    showToast(`PDF解析失敗: ${err.message}`, 'error');
    resetToUpload();
  } finally {
    analyzingIndicator.classList.add('hidden');
  }
}

// --- URL Analysis ---
const urlInput = document.getElementById('urlInput');
const analyzeUrlBtn = document.getElementById('analyzeUrlBtn');

analyzeUrlBtn.addEventListener('click', () => analyzeUrl());
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyzeUrl(); });

async function analyzeUrl() {
  const url = urlInput.value.trim();
  if (!url) { showToast('URLを入力してください', 'error'); return; }

  const apiKey = getApiKey();
  if (!apiKey) { showToast('API Keyを設定してください', 'error'); settingsModal.classList.remove('hidden'); return; }

  const gasUrl = getGasUrl();
  if (!gasUrl) { showToast('GAS URLを設定してください（URLの取得に必要です）', 'error'); return; }

  uploadSection.classList.add('hidden');
  previewSection.classList.remove('hidden');
  analyzingIndicator.classList.remove('hidden');
  analyzingIndicator.querySelector('p').textContent = 'ページを取得中...';

  try {
    const res = await fetch(`${gasUrl}?action=fetch_url&url=${encodeURIComponent(url)}`, { redirect: 'follow' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'ページの取得に失敗');

    const pageText = data.text;
    if (!pageText) throw new Error('ページからテキストを取得できませんでした');

    analyzingIndicator.querySelector('p').textContent = 'AIが解析中...';

    const today = new Date().toISOString().split('T')[0];
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `以下のWebページのテキストはレシート・領収書・注文確認・明細ページです。情報を抽出してください。JSON形式のみで返答（前置き・後書きなし）:
{
  "store": "店舗名・サービス名",
  "date": "YYYY-MM-DD形式の日付（不明な場合は${today}）",
  "amount": 数値（税込合計金額、数値のみ）,
  "category": "勘定科目（消耗品費/旅費交通費/通信費/接待交際費/会議費/新聞図書費/地代家賃/水道光熱費/外注工賃/広告宣伝費/福利厚生費/雑費/その他）",
  "taxRate": "税率（10%/8%/混在/不明）",
  "payment": "支払方法（現金/クレジットカード/電子マネー/QRコード決済/その他/不明）",
  "invoice": "インボイス登録番号（T+13桁、あれば）",
  "memo": "特記事項"
}

URL: ${url}
ページテキスト:
${pageText.substring(0, 4000)}`
        }]
      })
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    const aiData = await response.json();
    const respText = aiData.content[0].text.trim();
    const jsonMatch = respText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSONを抽出できませんでした');

    populateForm(JSON.parse(jsonMatch[0]));
    urlInput.value = '';
  } catch (err) {
    console.error('URL解析エラー:', err);
    showToast(`URL解析失敗: ${err.message}`, 'error');
    resetToUpload();
  } finally {
    analyzingIndicator.classList.add('hidden');
  }
}

// --- Gmail ---
const gmailSearchBtn = document.getElementById('gmailSearchBtn');
const gmailQuery = document.getElementById('gmailQuery');
const gmailList = document.getElementById('gmailList');

gmailSearchBtn.addEventListener('click', searchGmail);
gmailQuery.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchGmail(); });

async function searchGmail() {
  const gasUrl = getGasUrl();
  if (!gasUrl) { showToast('GAS URLを設定してください', 'error'); return; }

  gmailList.innerHTML = '<p class="history-empty">検索中...</p>';
  gmailSearchBtn.disabled = true;

  try {
    const q = encodeURIComponent(gmailQuery.value);
    const res = await fetch(`${gasUrl}?action=gmail&q=${q}`, { redirect: 'follow' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    if (data.emails.length === 0) {
      gmailList.innerHTML = '<p class="history-empty">該当するメールが見つかりません</p>';
      return;
    }

    gmailList.innerHTML = data.emails.map(email => {
      const date = new Date(email.date).toLocaleDateString('ja-JP');
      return `<div class="gmail-item" data-id="${email.id}">
        <div class="gmail-item-subject">${escapeHtml(email.subject)}</div>
        <div class="gmail-item-meta">${escapeHtml(email.from)} - ${date}</div>
        <div class="gmail-item-snippet">${escapeHtml(email.snippet)}</div>
      </div>`;
    }).join('');

    // クリックでメール本文を取得して解析
    gmailList.querySelectorAll('.gmail-item').forEach(item => {
      item.addEventListener('click', () => analyzeGmailMessage(item.dataset.id));
    });
  } catch (err) {
    console.error('Gmail検索エラー:', err);
    gmailList.innerHTML = '<p class="history-empty">検索に失敗しました。GASを再デプロイしてください</p>';
  } finally {
    gmailSearchBtn.disabled = false;
  }
}

async function analyzeGmailMessage(msgId) {
  const gasUrl = getGasUrl();
  const apiKey = getApiKey();
  if (!apiKey) { showToast('API Keyを設定してください', 'error'); return; }

  uploadSection.classList.add('hidden');
  previewSection.classList.remove('hidden');
  analyzingIndicator.classList.remove('hidden');
  analyzingIndicator.querySelector('p').textContent = 'メールを読み込み中...';

  try {
    // GASからメール本文を取得
    const res = await fetch(`${gasUrl}?action=gmail_read&id=${msgId}`, { redirect: 'follow' });
    const emailData = await res.json();
    if (!emailData.success) throw new Error(emailData.error);

    analyzingIndicator.querySelector('p').textContent = 'AIが解析中...';

    const today = new Date().toISOString().split('T')[0];
    const emailText = `件名: ${emailData.subject}\n送信者: ${emailData.from}\n日付: ${emailData.date}\n\n${emailData.body}`;

    // AIで解析
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `以下のメールはレシート・領収書・注文確認です。情報を抽出してください。JSON形式のみで返答（前置き・後書きなし）:
{
  "store": "店舗名・サービス名",
  "date": "YYYY-MM-DD形式の日付（不明な場合は${today}）",
  "amount": 数値（税込合計金額、数値のみ）,
  "category": "勘定科目（消耗品費/旅費交通費/通信費/接待交際費/会議費/新聞図書費/地代家賃/水道光熱費/外注工賃/広告宣伝費/福利厚生費/雑費/その他）",
  "taxRate": "税率（10%/8%/混在/不明）",
  "payment": "支払方法（現金/クレジットカード/電子マネー/QRコード決済/その他/不明）",
  "invoice": "インボイス登録番号（T+13桁、あれば）",
  "memo": "特記事項"
}

メール:
${emailText.substring(0, 4000)}`
        }]
      })
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    const aiData = await response.json();
    const respText = aiData.content[0].text.trim();
    const jsonMatch = respText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSONを抽出できませんでした');

    populateForm(JSON.parse(jsonMatch[0]));
  } catch (err) {
    console.error('Gmail解析エラー:', err);
    showToast(`解析失敗: ${err.message}`, 'error');
    resetToUpload();
  } finally {
    analyzingIndicator.classList.add('hidden');
  }
}

// --- 週次Gmail自動チェック ---
const weeklyScanBtn = document.getElementById('weeklyScanBtn');
const weeklyMeta = document.getElementById('weeklyMeta');
const weeklyReview = document.getElementById('weeklyReview');
const weeklyList = document.getElementById('weeklyList');
const weeklyCount = document.getElementById('weeklyCount');
const weeklySelectAllBtn = document.getElementById('weeklySelectAllBtn');
const weeklyDeselectAllBtn = document.getElementById('weeklyDeselectAllBtn');
const weeklyImportBtn = document.getElementById('weeklyImportBtn');

let weeklyCandidates = []; // {checked, confidence, store, date, amount, category, taxRate, payment, invoice, memo, emailId, emailSubject}

function updateWeeklyMeta() {
  if (!weeklyMeta) return;
  const last = localStorage.getItem('receipt_last_weekly_scan');
  if (!last) {
    weeklyMeta.textContent = 'まだ実行されていません';
    return;
  }
  const lastDate = new Date(last);
  const days = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
  const dStr = lastDate.toLocaleDateString('ja-JP');
  if (days >= 7) {
    weeklyMeta.innerHTML = `前回: ${dStr}（${days}日経過）<br><strong>そろそろチェック推奨</strong>`;
  } else {
    weeklyMeta.textContent = `前回: ${dStr}（${days}日前）`;
  }
}
if (weeklyScanBtn) {
  updateWeeklyMeta();
  weeklyScanBtn.addEventListener('click', runWeeklyScan);
  // 範囲プリセットの切り替え
  const scanRangePreset = document.getElementById('scanRangePreset');
  const scanRangeCustom = document.getElementById('scanRangeCustom');
  const scanRangeFrom = document.getElementById('scanRangeFrom');
  const scanRangeTo = document.getElementById('scanRangeTo');
  const weeklyScanBtnLabel = document.getElementById('weeklyScanBtnLabel');
  // デフォルト：先月
  if (scanRangeFrom && scanRangeTo) {
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth()+1).padStart(2,'0')}`;
    scanRangeFrom.value = lastMonthStr;
    scanRangeTo.value = lastMonthStr;
  }
  function updateRangeUI() {
    const v = scanRangePreset?.value;
    if (v === 'custom') scanRangeCustom?.classList.remove('hidden');
    else scanRangeCustom?.classList.add('hidden');
    // ボタンラベル更新
    if (weeklyScanBtnLabel) {
      const labels = { '7': '過去7日間', '30': '過去30日間', 'last-month': '先月', 'this-month': '今月', 'custom': 'カスタム範囲' };
      weeklyScanBtnLabel.textContent = `${labels[v] || ''}の領収書メールをチェック`;
    }
  }
  if (scanRangePreset) scanRangePreset.addEventListener('change', updateRangeUI);
  updateRangeUI();
}

function buildScanRangeParams() {
  const preset = document.getElementById('scanRangePreset')?.value || '7';
  const params = new URLSearchParams({ action: 'gmail', limit: '100' });
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = new Date();
  let label;
  if (preset === '7') { params.set('days', '7'); label = '過去7日間'; }
  else if (preset === '30') { params.set('days', '30'); label = '過去30日間'; }
  else if (preset === 'last-month') {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 1);
    params.set('after', fmt(first));
    params.set('before', fmt(last));
    label = `${first.getFullYear()}年${first.getMonth()+1}月`;
  } else if (preset === 'this-month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    params.set('after', fmt(first));
    params.set('before', fmt(last));
    label = `${first.getFullYear()}年${first.getMonth()+1}月`;
  } else if (preset === 'custom') {
    const fromVal = document.getElementById('scanRangeFrom')?.value;
    const toVal = document.getElementById('scanRangeTo')?.value;
    if (!fromVal || !toVal) { return { error: '開始月と終了月を指定してください' }; }
    const [fy, fm] = fromVal.split('-').map(Number);
    const [ty, tm] = toVal.split('-').map(Number);
    const after = new Date(fy, fm - 1, 1);
    const before = new Date(ty, tm, 1); // 翌月1日
    if (before <= after) return { error: '終了月は開始月以降にしてください' };
    params.set('after', fmt(after));
    params.set('before', fmt(before));
    label = fromVal === toVal ? `${fy}年${fm}月` : `${fy}年${fm}月〜${ty}年${tm}月`;
  } else { params.set('days', '7'); label = '過去7日間'; }
  return { params, label };
}

async function runWeeklyScan() {
  const apiKey = getApiKey();
  if (!apiKey) { showToast('API Keyを設定してください', 'error'); return; }
  const gasUrl = getGasUrl();
  if (!gasUrl) { showToast('GAS URLを設定してください', 'error'); return; }

  const range = buildScanRangeParams();
  if (range.error) { showToast(range.error, 'error'); return; }

  weeklyScanBtn.disabled = true;
  const origText = weeklyScanBtn.innerHTML;
  weeklyScanBtn.textContent = `${range.label}のメール取得中...`;
  weeklyReview.classList.add('hidden');

  try {
    const res = await fetch(`${gasUrl}?${range.params.toString()}`, { redirect: 'follow' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Gmail検索失敗');

    if (!data.emails || data.emails.length === 0) {
      showToast(`${range.label}に該当メールはありません`, 'success');
      return;
    }

    weeklyScanBtn.textContent = `AI分類中... (${data.emails.length}件)`;
    const fetchedCount = data.emails.length;

    // 2. AI一括分類＋抽出
    const candidates = await classifyAndExtractEmails(apiKey, data.emails);

    if (candidates.length === 0) {
      showToast(`Gmail検索: ${fetchedCount}件取得 → AI判定: 経費メール 0件`, 'success');
      localStorage.setItem('receipt_last_weekly_scan', new Date().toISOString());
      updateWeeklyMeta();
      return;
    }

    // 3. 重複チェック（既存allRecordsとマッチしたら自動で除外）
    weeklyCandidates = candidates.map(c => ({
      ...c,
      checked: c.confidence === 'high' && !isDuplicate(c),
      duplicate: isDuplicate(c)
    }));

    showToast(`Gmail取得 ${fetchedCount}件 → AI判定 ${candidates.length}件が経費候補`);
    renderWeeklyList();
    weeklyReview.classList.remove('hidden');
    localStorage.setItem('receipt_last_weekly_scan', new Date().toISOString());
    updateWeeklyMeta();
  } catch (err) {
    console.error('週次チェックエラー:', err);
    showToast('チェック失敗: ' + err.message, 'error');
  } finally {
    weeklyScanBtn.disabled = false;
    weeklyScanBtn.innerHTML = origText;
  }
}

function isDuplicate(c) {
  if (!c.date || !c.store || !c.amount) return false;
  return allRecords.some(r =>
    String(r.store) === String(c.store) &&
    Number(r.amount) === Number(c.amount) &&
    String(r.date).substring(0, 10) === String(c.date).substring(0, 10)
  );
}

async function classifyAndExtractEmails(apiKey, emails) {
  const today = new Date().toISOString().split('T')[0];
  // メールのタイトル+送信元+スニペットを一括投入
  const emailList = emails.map((e, i) => `[${i}] 件名: ${e.subject}\n送信元: ${e.from}\n本文抜粋: ${e.snippet}`).join('\n\n---\n\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: `以下は最近のメール一覧です。各メールについて経費・支払い・購入の記録になりうるかを判定してください。

【含めるもの】
- 領収書、レシート、請求書、インボイス
- 注文確認、購入確認、決済完了通知
- サブスクリプションの継続課金通知（Netflix、Spotify、Adobe等）
- API/SaaS利用料の請求（Anthropic、AWS、GitHub等）
- 配送通知でも商品名と金額が明記されているもの
- ホテル・交通機関・飲食店の予約完了通知（金額確定済み）
- 公共料金・通信費の請求

【除外するもの】
- セール案内、クーポン配布、メルマガ
- 未確定の見積もり、仮予約、カート放棄リマインド
- パスワード変更、アカウント通知などの管理メール

判定方針: 迷ったら含める。「金額が判別できる」「発生済みの取引」が判定基準。

confidence の基準:
- high: 金額・店舗・日付がほぼ明確
- medium: いずれかが不明瞭、または推測を要する
- low: 経費可能性はあるが情報不足（金額不明など）

JSON配列のみで返答（前置き・後書きなし）：
[
  {
    "index": 該当メールの番号,
    "confidence": "high"|"medium"|"low",
    "store": "店舗名・サービス名",
    "date": "YYYY-MM-DD（不明なら${today}）",
    "amount": 数値（税込合計、不明なら null）,
    "category": "勘定科目（消耗品費/旅費交通費/通信費/接待交際費/会議費/新聞図書費/地代家賃/水道光熱費/外注工賃/広告宣伝費/福利厚生費/雑費/その他）",
    "taxRate": "10%/8%/混在/不明",
    "payment": "現金/クレジットカード/電子マネー/QRコード決済/その他/不明",
    "invoice": "T+13桁",
    "memo": "メールの主要情報・備考"
  }
]

メール一覧:
${emailList}`
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API Error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('AI応答からJSONを抽出できませんでした');

  const results = JSON.parse(jsonMatch[0]);
  return results.filter(r => r && typeof r.index === 'number' && emails[r.index]).map(r => ({
    confidence: r.confidence || 'medium',
    store: r.store || '',
    date: r.date || today,
    amount: r.amount || '',
    category: r.category || '雑費',
    taxRate: r.taxRate || '不明',
    payment: r.payment || '不明',
    invoice: r.invoice || '',
    memo: r.memo || '',
    emailId: emails[r.index].id,
    emailSubject: emails[r.index].subject,
    emailFrom: emails[r.index].from
  }));
}

function renderWeeklyList() {
  if (!weeklyList || !weeklyCount) return;
  weeklyCount.textContent = `${weeklyCandidates.length}件（${weeklyCandidates.filter(c => c.checked).length}件選択中）`;
  weeklyList.innerHTML = weeklyCandidates.map((c, i) => {
    const confLabel = { high: '確度高', medium: '確度中', low: '確度低' }[c.confidence] || '';
    const confClass = c.confidence;
    const dupBadge = c.duplicate ? '<span class="weekly-confidence" style="background:#ef444433;color:#ef4444">重複</span>' : '';
    const amtStr = c.amount ? `&yen;${Number(c.amount).toLocaleString()}` : '<em>金額不明</em>';
    return `<div class="weekly-item ${c.confidence === 'low' ? 'confidence-low' : ''}" data-idx="${i}">
      <input type="checkbox" data-idx="${i}" ${c.checked ? 'checked' : ''}>
      <div class="weekly-item-body">
        <div class="weekly-item-store">
          <span class="weekly-confidence ${confClass}">${confLabel}</span>${dupBadge}${escapeHtml(c.store || c.emailSubject || '(不明)')}
        </div>
        <div class="weekly-item-meta">${formatDate(c.date)} · ${escapeHtml(c.category)} · <span class="weekly-item-edit" data-idx="${i}">編集</span></div>
      </div>
      <div class="weekly-item-amount">${amtStr}</div>
    </div>`;
  }).join('');

  weeklyList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      weeklyCandidates[Number(cb.dataset.idx)].checked = cb.checked;
      weeklyCount.textContent = `${weeklyCandidates.length}件（${weeklyCandidates.filter(c => c.checked).length}件選択中）`;
    });
  });
  weeklyList.querySelectorAll('.weekly-item-edit').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openWeeklyEdit(Number(el.dataset.idx));
    });
  });
}

function openWeeklyEdit(idx) {
  const c = weeklyCandidates[idx];
  // 編集モーダルを再利用
  editingRecord = null; // 通常編集と区別
  document.getElementById('editStore').value = c.store || '';
  document.getElementById('editDate').value = c.date || new Date().toISOString().split('T')[0];
  document.getElementById('editAmount').value = c.amount || '';
  document.getElementById('editCategory').value = c.category || '雑費';
  document.getElementById('editMemo').value = c.memo || '';
  document.getElementById('editExpenseType').value = '事業';
  document.getElementById('editProration').value = 100;
  // 削除ボタンを「キャンセル」に
  editDeleteBtn.textContent = 'キャンセル';
  editSaveBtn.textContent = '反映';
  editingWeeklyIdx = idx;
  editModal.classList.remove('hidden');
}

let editingWeeklyIdx = -1;

if (weeklySelectAllBtn) weeklySelectAllBtn.addEventListener('click', () => {
  weeklyCandidates.forEach(c => c.checked = true);
  renderWeeklyList();
});
if (weeklyDeselectAllBtn) weeklyDeselectAllBtn.addEventListener('click', () => {
  weeklyCandidates.forEach(c => c.checked = false);
  renderWeeklyList();
});

if (weeklyImportBtn) weeklyImportBtn.addEventListener('click', async () => {
  const selected = weeklyCandidates.filter(c => c.checked);
  if (selected.length === 0) { showToast('項目を選択してください', 'error'); return; }
  const gasUrl = getGasUrl();
  if (!gasUrl) { showToast('GAS URLを設定してください', 'error'); return; }
  if (!confirm(`${selected.length}件をスプレッドシートに登録します。よろしいですか？`)) return;

  weeklyImportBtn.disabled = true;
  let saved = 0;
  for (const c of selected) {
    const amount = Number(c.amount) || 0;
    if (amount <= 0) continue;
    const taxRate = c.taxRate === '8%' ? 0.08 : (c.taxRate === '非課税' ? 0 : 0.10);
    const exTax = Math.round(amount / (1 + taxRate));
    weeklyImportBtn.textContent = `保存中 ${saved + 1}/${selected.length}...`;
    await fetch(gasUrl, {
      method: 'POST', mode: 'no-cors',
      body: JSON.stringify({
        date: c.date, store: c.store, amount: amount,
        category: c.category, taxRate: c.taxRate, payment: c.payment,
        invoice: c.invoice, memo: c.memo, expenseType: '事業',
        proration: 100, exTax: exTax, tax: amount - exTax,
        businessAmount: amount
      })
    });
    saved++;
  }

  weeklyImportBtn.disabled = false;
  weeklyImportBtn.textContent = '選択した項目を登録';
  showToast(`${saved}件を登録しました`);
  weeklyReview.classList.add('hidden');
  weeklyCandidates = [];
  setTimeout(fetchAllHistory, 2000);
});

// --- Image Handling ---
const API_SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const HEIC_TYPES = ['image/heic', 'image/heif'];
const ALL_SUPPORTED_TYPES = [...API_SUPPORTED_TYPES, ...HEIC_TYPES];

function isHeic(file) {
  if (HEIC_TYPES.includes(file.type)) return true;
  const name = file.name.toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif');
}

const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024; // 3.5MB（base64で約4.7MBになり5MB制限内に収まる）

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { naturalWidth: w, naturalHeight: h } = img;

      // 長辺を段階的に縮小しながら5MB以下になるまで試行
      const tryCompress = (scale) => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error('圧縮失敗')); return; }
            if (blob.size <= MAX_IMAGE_BYTES || scale <= 0.2) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
            } else {
              tryCompress(scale * 0.7);
            }
          },
          'image/jpeg',
          0.85
        );
      };
      tryCompress(1);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像読み込み失敗'));
    };
    img.src = url;
  });
}

async function handleFile(file) {
  if (!file) return;

  // PDFの場合はPDF処理へ
  if (isPdf(file)) {
    handlePdf(file);
    return;
  }

  // HEIC/HEIFの場合はtype空文字の場合もあるのでファイル名でも判定
  const supported = ALL_SUPPORTED_TYPES.includes(file.type) || isHeic(file);
  if (!supported) {
    showToast('対応形式: JPEG, PNG, GIF, WebP, HEIC, PDF', 'error');
    return;
  }

  // HEIC/HEIFの場合はJPEGに変換（heic-toライブラリ使用）
  let processedFile = file;
  if (isHeic(file)) {
    uploadSection.classList.add('hidden');
    previewSection.classList.remove('hidden');
    analyzingIndicator.classList.remove('hidden');
    analyzingIndicator.querySelector('p').textContent = 'HEIC→JPEG変換中...';

    try {
      const jpegBlob = await HeicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
      processedFile = new File([jpegBlob], file.name.replace(/\.heic|\.heif/i, '.jpg'), { type: 'image/jpeg' });
    } catch (err) {
      console.error('HEIC変換エラー:', err);
      // ブラウザが既にJPEGとして渡している場合はそのまま使う
      if (API_SUPPORTED_TYPES.includes(file.type)) {
        processedFile = file;
      } else {
        showToast('HEIC変換に失敗しました。JPEG/PNGで再試行してください', 'error');
        resetToUpload();
        return;
      }
    }
  }

  // 5MB超の場合はJPEG圧縮
  if (processedFile.size > MAX_IMAGE_BYTES) {
    try {
      analyzingIndicator.classList.remove('hidden');
      analyzingIndicator.querySelector('p').textContent = '画像を圧縮中...';
      processedFile = await compressImage(processedFile);
    } catch (err) {
      console.error('圧縮エラー:', err);
      showToast('画像の圧縮に失敗しました', 'error');
      resetToUpload();
      return;
    }
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    currentMediaType = processedFile.type;
    currentBase64 = dataUrl.split(',')[1];

    previewImage.src = dataUrl;
    uploadSection.classList.add('hidden');
    previewSection.classList.remove('hidden');
    editSection.classList.add('hidden');

    analyzeReceipt();
  };
  reader.readAsDataURL(processedFile);
}

// Drag & Drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// File inputs
cameraInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

// Remove image
removeImageBtn.addEventListener('click', resetToUpload);

function resetToUpload() {
  currentBase64 = null;
  currentMediaType = null;
  previewSection.classList.add('hidden');
  editSection.classList.add('hidden');
  analyzingIndicator.classList.add('hidden');
  const errEl = document.getElementById('analyzeError');
  if (errEl) errEl.classList.add('hidden');
  uploadSection.classList.remove('hidden');
  // メイン入力に戻す
  inputMain.classList.remove('hidden');
  inputAlt.classList.add('hidden');
  cameraInput.value = '';
  fileInput.value = '';
  currencySelect.value = 'JPY';
  currencyConvertRow.classList.add('hidden');
  exchangeRateInput.value = '';
  jpyAmountDisplay.value = '';
}

// --- Anthropic API ---
const analyzeError = document.getElementById('analyzeError');
const analyzeErrorMsg = document.getElementById('analyzeErrorMsg');
const retryAnalyzeBtn = document.getElementById('retryAnalyzeBtn');
const manualEntryBtn = document.getElementById('manualEntryBtn');
const retryInfo = document.getElementById('retryInfo');

async function callAnthropicForReceipt(apiKey, today) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: currentMediaType, data: currentBase64 } },
          {
            type: 'text',
            text: `このレシート画像から情報を抽出してください。JSON形式のみで返答してください（前置き・後書きなし）:
{
  "store": "店舗名",
  "date": "YYYY-MM-DD形式の日付（不明な場合は${today}）",
  "amount": 数値（税込合計金額、数値のみ）,
  "category": "勘定科目（消耗品費/旅費交通費/通信費/接待交際費/会議費/新聞図書費/地代家賃/水道光熱費/外注工賃/広告宣伝費/福利厚生費/雑費/その他）",
  "taxRate": "税率（10%/8%/混在/不明 から選択。食品は軽減税率8%、それ以外は10%。両方あれば混在）",
  "payment": "支払方法（現金/クレジットカード/電子マネー/QRコード決済/その他/不明 から選択。レシートに記載があれば）",
  "invoice": "インボイス登録番号（T+13桁の番号がレシートに印字されていれば。なければ空文字）",
  "memo": "レシートの特記事項があれば"
}`
          }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(err.error?.message || `API Error: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const text = data.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AIの応答からJSONを抽出できませんでした');
  return JSON.parse(jsonMatch[0]);
}

function isRetryableError(err) {
  // 4xx系（401/400など）はリトライ無意味。ネットワークエラー or 5xx or 429のみリトライ
  if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) return false;
  return true;
}

async function analyzeReceipt(isRetry = false) {
  const apiKey = getApiKey();
  if (!apiKey) {
    showToast('API Keyを設定してください', 'error');
    settingsModal.classList.remove('hidden');
    resetToUpload();
    return;
  }

  if (analyzeError) analyzeError.classList.add('hidden');
  analyzingIndicator.classList.remove('hidden');
  analyzingIndicator.querySelector('p').textContent = 'AIが解析中...';
  if (retryInfo) retryInfo.classList.add('hidden');

  const today = new Date().toISOString().split('T')[0];
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        retryInfo.classList.remove('hidden');
        retryInfo.textContent = `通信エラー、リトライ中... (${attempt}/${maxAttempts})`;
      }
      const result = await callAnthropicForReceipt(apiKey, today);
      analyzingIndicator.classList.add('hidden');
      populateForm(result);
      return;
    } catch (err) {
      console.error(`解析エラー (attempt ${attempt}):`, err);
      lastError = err;
      if (!isRetryableError(err) || attempt === maxAttempts) break;
      // 指数バックオフ: 1秒, 2秒
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  // すべて失敗：画像とフォームは保持して再試行/手動入力を提示
  analyzingIndicator.classList.add('hidden');
  if (analyzeErrorMsg) analyzeErrorMsg.textContent = `解析失敗: ${lastError?.message || '不明なエラー'}`;
  if (analyzeError) analyzeError.classList.remove('hidden');
  showToast('解析失敗。再試行か手動入力してください', 'error');
}

if (retryAnalyzeBtn) retryAnalyzeBtn.addEventListener('click', () => {
  if (currentBase64) analyzeReceipt(true);
});

if (manualEntryBtn) manualEntryBtn.addEventListener('click', () => {
  if (analyzeError) analyzeError.classList.add('hidden');
  // 空のフォームを表示（今日の日付・雑費でデフォルト）
  populateForm({
    store: '', date: new Date().toISOString().split('T')[0], amount: '',
    category: '雑費', taxRate: '不明', payment: '不明', invoice: '', memo: ''
  });
});

const taxRateSelect = document.getElementById('taxRateSelect');
const paymentSelect = document.getElementById('paymentSelect');
const invoiceInput = document.getElementById('invoiceInput');
const expenseTypeSelect = document.getElementById('expenseTypeSelect');
const prorationInput = document.getElementById('prorationInput');
const calcExTax = document.getElementById('calcExTax');
const calcTax = document.getElementById('calcTax');
const calcBusiness = document.getElementById('calcBusiness');

// --- Currency ---
const currencySelect = document.getElementById('currencySelect');
const currencyConvertRow = document.getElementById('currencyConvertRow');
const exchangeRateInput = document.getElementById('exchangeRateInput');
const jpyAmountDisplay = document.getElementById('jpyAmountDisplay');

const DEFAULT_RATES = { USD: 150, EUR: 163, GBP: 190, CNY: 21, KRW: 0.11, TWD: 4.7, THB: 4.3 };

currencySelect.addEventListener('change', () => {
  const cur = currencySelect.value;
  if (cur === 'JPY') {
    currencyConvertRow.classList.add('hidden');
    exchangeRateInput.value = '';
    jpyAmountDisplay.value = '';
  } else {
    currencyConvertRow.classList.remove('hidden');
    if (!exchangeRateInput.value) {
      exchangeRateInput.value = DEFAULT_RATES[cur] || 1;
    }
    updateCurrencyConvert();
  }
  updateCalc();
});

exchangeRateInput.addEventListener('input', () => { updateCurrencyConvert(); updateCalc(); });
amountInput.addEventListener('input', () => { if (currencySelect.value !== 'JPY') updateCurrencyConvert(); });

function updateCurrencyConvert() {
  const amt = Number(amountInput.value) || 0;
  const rate = Number(exchangeRateInput.value) || 0;
  const jpyAmt = Math.round(amt * rate);
  jpyAmountDisplay.value = jpyAmt || '';
}

function getJpyAmount() {
  if (currencySelect.value === 'JPY') return Number(amountInput.value) || 0;
  return Number(jpyAmountDisplay.value) || 0;
}

// 按分率の連動: 「事業」なら100%、「個人」なら0%
expenseTypeSelect.addEventListener('change', () => {
  if (expenseTypeSelect.value === '事業') prorationInput.value = 100;
  else if (expenseTypeSelect.value === '個人') prorationInput.value = 0;
  updateCalc();
});

// 金額・税率・按分率の変更で自動計算
amountInput.addEventListener('input', updateCalc);
taxRateSelect.addEventListener('change', updateCalc);
prorationInput.addEventListener('input', updateCalc);

function updateCalc() {
  const amount = getJpyAmount();
  const taxStr = taxRateSelect.value;
  const proration = Math.min(100, Math.max(0, Number(prorationInput.value) || 0));

  let taxRate = 0.10;
  if (taxStr === '8%') taxRate = 0.08;
  else if (taxStr === '非課税') taxRate = 0;
  else if (taxStr === '混在' || taxStr === '不明') taxRate = 0.10;

  const exTax = Math.round(amount / (1 + taxRate));
  const tax = amount - exTax;
  const businessAmount = Math.round(amount * proration / 100);

  calcExTax.textContent = amount ? `¥${exTax.toLocaleString()}` : '-';
  calcTax.textContent = amount ? `¥${tax.toLocaleString()}` : '-';
  calcBusiness.textContent = amount ? `¥${businessAmount.toLocaleString()}` : '-';
}

// 旧カテゴリ→勘定科目マッピング
const CATEGORY_MAP = {
  '食費': '会議費', '交通費': '旅費交通費', '消耗品': '消耗品費',
  '接待費': '接待交際費', '通信費': '通信費', 'その他': '雑費'
};

function populateForm(result) {
  storeInput.value = result.store || '';
  dateInput.value = result.date || new Date().toISOString().split('T')[0];
  amountInput.value = result.amount || '';

  // 勘定科目: AIが返した値をそのまま使うか、旧カテゴリをマッピング
  let cat = result.category || '雑費';
  if (CATEGORY_MAP[cat]) cat = CATEGORY_MAP[cat];
  // selectにない値の場合は「雑費」にフォールバック
  const catOptions = [...categorySelect.options].map(o => o.value);
  categorySelect.value = catOptions.includes(cat) ? cat : '雑費';

  taxRateSelect.value = result.taxRate || '不明';
  paymentSelect.value = result.payment || '不明';
  invoiceInput.value = result.invoice || '';
  memoInput.value = result.memo || '';
  expenseTypeSelect.value = result.expenseType || '事業';
  prorationInput.value = result.proration != null ? result.proration : 100;

  // 有意な税・支払情報があれば詳細欄を自動展開
  const formDetails = document.getElementById('formDetails');
  const hasDetail = (result.taxRate && result.taxRate !== '不明') ||
                    (result.payment && result.payment !== '不明') ||
                    result.invoice ||
                    (result.expenseType && result.expenseType !== '事業');
  if (hasDetail) {
    formDetails.setAttribute('open', '');
  } else {
    formDetails.removeAttribute('open');
  }

  updateCalc();
  editSection.classList.remove('hidden');
  editSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Save to Google Sheets ---
receiptForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const gasUrl = getGasUrl();
  if (!gasUrl) {
    showToast('GAS URLを設定してください', 'error');
    settingsModal.classList.remove('hidden');
    return;
  }

  const jpyAmount = getJpyAmount();
  const taxStr = taxRateSelect.value;
  let taxRate = 0.10;
  if (taxStr === '8%') taxRate = 0.08;
  else if (taxStr === '非課税') taxRate = 0;
  const exTax = Math.round(jpyAmount / (1 + taxRate));
  const proration = Math.min(100, Math.max(0, Number(prorationInput.value) || 0));

  // 外貨の場合はメモに通貨情報を追加
  let memo = memoInput.value;
  if (currencySelect.value !== 'JPY') {
    const foreignAmt = Number(amountInput.value) || 0;
    const cur = currencySelect.value;
    const rate = Number(exchangeRateInput.value) || 0;
    const currencyNote = `[${cur} ${foreignAmt} @${rate}]`;
    memo = memo ? `${currencyNote} ${memo}` : currencyNote;
  }

  const record = {
    date: dateInput.value,
    store: storeInput.value,
    amount: jpyAmount,
    category: categorySelect.value,
    taxRate: taxRateSelect.value,
    payment: paymentSelect.value,
    invoice: invoiceInput.value,
    memo: memo,
    expenseType: expenseTypeSelect.value,
    proration: proration,
    exTax: exTax,
    tax: jpyAmount - exTax,
    businessAmount: Math.round(jpyAmount * proration / 100)
  };

  // 画像データがあれば添付（電帳法対応：Google Driveに保存）
  if (currentBase64) {
    record.imageBase64 = currentBase64;
    record.imageMediaType = currentMediaType;
  }

  savingOverlay.classList.remove('hidden');
  if (currentBase64) {
    savingOverlay.querySelector('p').textContent = '画像をDriveに保存中...';
  }

  try {
    // GAS WebアプリはPOST時に302リダイレクトするため、no-corsモードで送信
    await fetch(gasUrl, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify(record)
    });
    // no-corsではレスポンス内容を読めないため、エラーが投げられなければ成功とみなす
    addToHistory(record);
    showToast(currentBase64 ? 'スプレッドシート＋Driveに保存しました' : 'スプレッドシートに保存しました');
    resetToUpload();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error('保存エラー:', err);
    showToast(`保存失敗: ${err.message}`, 'error');
  } finally {
    savingOverlay.classList.add('hidden');
  }
});

cancelBtn.addEventListener('click', resetToUpload);

// --- History ---
function addToHistory(record) {
  history.unshift(record);
  renderHistory();
}

const historySection = document.getElementById('historySection');

function renderHistory() {
  if (history.length === 0) {
    historySection.classList.add('hidden');
    return;
  }
  historySection.classList.remove('hidden');

  historyCount.textContent = history.length;
  historyList.innerHTML = history.map((r) => `
    <div class="history-item">
      <div class="history-store">${escapeHtml(r.store)}</div>
      <div class="history-amount">&yen;${r.amount.toLocaleString()}${r.proration && r.proration < 100 ? '<small class="history-proration">(' + r.proration + '%)</small>' : ''}</div>
      <div class="history-meta">${formatDate(r.date)}${r.payment && r.payment !== '不明' ? ' / ' + escapeHtml(r.payment) : ''}</div>
      <div class="history-category">${escapeHtml(r.category)}</div>
    </div>
  `).join('');
}

function formatDate(d) {
  const s = String(d);
  const m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  return m ? `${m[1]}/${m[2].padStart(2,'0')}/${m[3].padStart(2,'0')}` : s.split('T')[0] || s;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- All History (from Spreadsheet) ---
const allHistoryList = document.getElementById('allHistoryList');
const allHistoryCount = document.getElementById('allHistoryCount');
const historySummary = document.getElementById('historySummary');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const filterCategory = document.getElementById('filterCategory');
const filterMonth = document.getElementById('filterMonth');
const sheetLink = document.getElementById('sheetLink');

let allRecords = [];

// スプレッドシートリンクを設定
function updateSheetLink() {
  const sheetUrl = localStorage.getItem('receipt_sheet_url') || '';
  if (sheetUrl) {
    sheetLink.href = sheetUrl;
    sheetLink.classList.remove('hidden');
  } else {
    sheetLink.classList.add('hidden');
  }
}

async function fetchAllHistory() {
  const gasUrl = getGasUrl();
  if (!gasUrl) {
    allHistoryList.innerHTML = '<p class="history-empty">GAS URLを設定してください</p>';
    return;
  }

  allHistoryList.innerHTML = '<p class="history-empty">読み込み中...</p>';

  try {
    const res = await fetch(gasUrl, { redirect: 'follow' });
    const text = await res.text();
    const data = JSON.parse(text);
    if (!data.success) throw new Error(data.error || '取得に失敗');
    allRecords = (data.records || []).sort((a, b) => {
      const da = String(a.date), db = String(b.date);
      return da < db ? 1 : da > db ? -1 : 0;
    });
    applyFilters();
  } catch (err) {
    console.error('履歴取得エラー:', err);
    allHistoryList.innerHTML = '<p class="history-empty">履歴の取得に失敗しました</p>';
  }
}

function applyFilters() {
  let filtered = allRecords;

  const cat = filterCategory.value;
  if (cat) filtered = filtered.filter(r => r.category === cat);

  const month = filterMonth.value;
  if (month) filtered = filtered.filter(r => String(r.date).startsWith(month));

  renderAllHistory(filtered);
  renderSummary(filtered);
}

function renderAllHistory(records) {
  allHistoryCount.textContent = records.length || '';

  if (records.length === 0) {
    allHistoryList.innerHTML = '<p class="history-empty">該当する記録がありません</p>';
    return;
  }

  allHistoryList.innerHTML = records.map((r, idx) => {
    const ba = Number(r.businessAmount) || Number(r.amount);
    const amt = Number(r.amount);
    const showProration = ba !== amt && ba > 0;
    return `<div class="history-item" data-ridx="${idx}">
      <div class="history-store">${escapeHtml(String(r.store))}</div>
      <div class="history-amount">&yen;${amt.toLocaleString()}${showProration ? '<small class="history-proration">(経費&yen;' + ba.toLocaleString() + ')</small>' : ''}</div>
      <div class="history-meta">${formatDate(r.date)}${r.driveUrl ? ' <a href="' + escapeHtml(String(r.driveUrl)) + '" target="_blank" rel="noopener" class="drive-icon" title="画像を開く" onclick="event.stopPropagation()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></a>' : ''}${r.memo ? ' - ' + escapeHtml(String(r.memo)) : ''}</div>
      <div class="history-category">${escapeHtml(String(r.category))}</div>
    </div>`;
  }).join('');

  // 履歴アイテムクリックで編集モーダル
  allHistoryList.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = Number(item.dataset.ridx);
      if (records[idx]) openEditModal(records[idx]);
    });
  });
}

function renderSummary(records) {
  if (records.length === 0) {
    historySummary.innerHTML = '';
    return;
  }

  const total = records.reduce((sum, r) => sum + Number(r.amount), 0);
  const count = records.length;

  historySummary.innerHTML = `
    <div class="summary-card">
      <div class="summary-label">件数</div>
      <div class="summary-value">${count}件</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">合計</div>
      <div class="summary-value">&yen;${total.toLocaleString()}</div>
    </div>
  `;
}

refreshHistoryBtn.addEventListener('click', fetchAllHistory);
filterCategory.addEventListener('change', applyFilters);
filterMonth.addEventListener('change', applyFilters);

// --- Tabs ---
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
let currentTab = 'list';

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    currentTab = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.toggle('active', b === btn));
    tabContents.forEach(c => c.classList.toggle('active', c.id === 'tab' + capitalize(currentTab)));
    refreshTabView();
  });
});

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function refreshTabView() {
  if (currentTab === 'monthly') renderMonthlyView();
  if (currentTab === 'yearly') renderYearlyView();
  if (currentTab === 'journal') renderJournalView();
}

// --- Monthly filter ---
const filterCategoryMonthly = document.getElementById('filterCategoryMonthly');
filterCategoryMonthly.addEventListener('change', () => {
  if (currentTab === 'monthly') renderMonthlyView();
});

// --- Category colors ---
const CAT_COLORS = {
  '消耗品費': { color: '#f59e0b', cls: 'cat-supply' },
  '旅費交通費': { color: '#10b981', cls: 'cat-transport' },
  '通信費': { color: '#8b5cf6', cls: 'cat-comm' },
  '接待交際費': { color: '#ef4444', cls: 'cat-entertain' },
  '会議費': { color: '#3b82f6', cls: 'cat-meeting' },
  '新聞図書費': { color: '#06b6d4', cls: 'cat-books' },
  '地代家賃': { color: '#d946ef', cls: 'cat-rent' },
  '水道光熱費': { color: '#f97316', cls: 'cat-utility' },
  '外注工賃': { color: '#14b8a6', cls: 'cat-outsource' },
  '広告宣伝費': { color: '#e11d48', cls: 'cat-ad' },
  '福利厚生費': { color: '#84cc16', cls: 'cat-welfare' },
  '雑費': { color: '#6b7280', cls: 'cat-misc' },
  'その他': { color: '#9ca3af', cls: 'cat-other' },
  // 旧カテゴリ互換
  '食費': { color: '#3b82f6', cls: 'cat-meeting' },
  '交通費': { color: '#10b981', cls: 'cat-transport' },
  '消耗品': { color: '#f59e0b', cls: 'cat-supply' },
  '接待費': { color: '#ef4444', cls: 'cat-entertain' },
};

// --- Grouping ---
function extractMonth(dateVal) {
  const s = String(dateVal);
  const m = s.match(/(\d{4})[\/\-](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
}

function extractYear(dateVal) {
  const s = String(dateVal);
  const m = s.match(/(\d{4})/);
  return m ? m[1] : null;
}

function groupByMonth(records) {
  const groups = {};
  records.forEach(r => {
    const key = extractMonth(r.date);
    if (!key) return;
    if (!groups[key]) groups[key] = { total: 0, count: 0, categories: {} };
    const amt = Number(r.amount) || 0;
    groups[key].total += amt;
    groups[key].count++;
    const cat = r.category || 'その他';
    groups[key].categories[cat] = (groups[key].categories[cat] || 0) + amt;
  });
  return groups;
}

function groupByYear(records) {
  const groups = {};
  const monthsSeen = {};
  records.forEach(r => {
    const year = extractYear(r.date);
    const month = extractMonth(r.date);
    if (!year) return;
    if (!groups[year]) groups[year] = { total: 0, count: 0, categories: {}, months: new Set() };
    const amt = Number(r.amount) || 0;
    groups[year].total += amt;
    groups[year].count++;
    if (month) groups[year].months.add(month);
    const cat = r.category || 'その他';
    groups[year].categories[cat] = (groups[year].categories[cat] || 0) + amt;
  });
  return groups;
}

function catBarHtml(categories, total) {
  if (total === 0) return '';
  const segs = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => {
      const pct = (amt / total * 100).toFixed(1);
      const color = (CAT_COLORS[cat] || CAT_COLORS['その他']).color;
      return `<div class="cat-bar-seg" style="width:${pct}%;background:${color}"></div>`;
    }).join('');
  const legend = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => {
      const cls = (CAT_COLORS[cat] || CAT_COLORS['その他']).cls;
      return `<span class="${cls}">${escapeHtml(cat)} &yen;${amt.toLocaleString()}</span>`;
    }).join('');
  return `<div class="cat-bar">${segs}</div><div class="cat-bar-legend">${legend}</div>`;
}

// --- Record list HTML helper ---
function recordListHtml(records, key) {
  return records.map((r, i) => {
    const amt = Number(r.amount) || 0;
    return `<div class="history-item" data-group-key="${key}" data-ridx="${i}">
      <div class="history-store">${escapeHtml(String(r.store))}</div>
      <div class="history-amount">&yen;${amt.toLocaleString()}</div>
      <div class="history-meta">${formatDate(r.date)}${r.memo ? ' - ' + escapeHtml(String(r.memo)) : ''}</div>
      <div class="history-category">${escapeHtml(String(r.category))}</div>
    </div>`;
  }).join('');
}

// --- Monthly View ---
function renderMonthlyView() {
  const container = document.getElementById('monthlyView');
  let records = allRecords;
  const catFilter = filterCategoryMonthly.value;
  if (catFilter) records = records.filter(r => r.category === catFilter);

  const grouped = groupByMonth(records);
  const months = Object.keys(grouped).sort().reverse();

  if (months.length === 0) {
    container.innerHTML = '<p class="history-empty">データがありません</p>';
    return;
  }

  // 月ごとにレコードをグループ化
  const recordsByMonth = {};
  records.forEach(r => {
    const key = extractMonth(r.date);
    if (!key) return;
    if (!recordsByMonth[key]) recordsByMonth[key] = [];
    recordsByMonth[key].push(r);
  });

  const rows = months.map(m => {
    const g = grouped[m];
    const [y, mo] = m.split('-');
    const label = `${y}年${parseInt(mo)}月`;
    return `<tr class="month-row" data-month="${m}" style="cursor:pointer">
      <td class="month-label">${label} <span class="expand-icon">&#9654;</span></td>
      <td class="right">${g.count}件</td>
      <td class="right amount">&yen;${g.total.toLocaleString()}</td>
    </tr>
    <tr><td colspan="3">${catBarHtml(g.categories, g.total)}</td></tr>
    <tr class="month-detail hidden" data-month-detail="${m}"><td colspan="3">
      <div class="group-record-list">${recordListHtml(recordsByMonth[m] || [], m)}</div>
    </td></tr>`;
  }).join('');

  const grandTotal = months.reduce((s, m) => s + grouped[m].total, 0);

  container.innerHTML = `
    <div class="history-summary">
      <div class="summary-card"><div class="summary-label">合計</div><div class="summary-value">&yen;${grandTotal.toLocaleString()}</div></div>
      <div class="summary-card"><div class="summary-label">月平均</div><div class="summary-value">&yen;${Math.round(grandTotal / months.length).toLocaleString()}</div></div>
    </div>
    <table class="summary-table">
      <thead><tr><th>月</th><th class="right">件数</th><th class="right">合計</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  // クリックで展開/折りたたみ
  container.querySelectorAll('.month-row').forEach(row => {
    row.addEventListener('click', () => {
      const m = row.dataset.month;
      const detail = container.querySelector(`[data-month-detail="${m}"]`);
      const icon = row.querySelector('.expand-icon');
      detail.classList.toggle('hidden');
      icon.textContent = detail.classList.contains('hidden') ? '\u25B6' : '\u25BC';
    });
  });

  // 明細クリックで編集
  container.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = item.dataset.groupKey;
      const idx = Number(item.dataset.ridx);
      if (recordsByMonth[key] && recordsByMonth[key][idx]) openEditModal(recordsByMonth[key][idx]);
    });
  });
}

// --- Yearly View ---
function renderYearlyView() {
  const grouped = groupByYear(allRecords);
  const years = Object.keys(grouped).sort().reverse();
  const container = document.getElementById('yearlyView');

  if (years.length === 0) {
    container.innerHTML = '<p class="history-empty">データがありません</p>';
    return;
  }

  // 年ごとにレコードをグループ化
  const recordsByYear = {};
  allRecords.forEach(r => {
    const year = extractYear(r.date);
    if (!year) return;
    if (!recordsByYear[year]) recordsByYear[year] = [];
    recordsByYear[year].push(r);
  });

  container.innerHTML = years.map(y => {
    const g = grouped[y];
    const monthCount = g.months.size;
    const monthAvg = monthCount > 0 ? Math.round(g.total / monthCount) : 0;
    return `<div class="yearly-summary-card" data-year="${y}">
      <div class="yearly-header" style="cursor:pointer">
        <h3>${y}年 <span class="expand-icon">&#9654;</span></h3>
        <div class="yearly-stats">
          <div class="yearly-stat"><div class="label">件数</div><div class="value">${g.count}件</div></div>
          <div class="yearly-stat"><div class="label">合計</div><div class="value">&yen;${g.total.toLocaleString()}</div></div>
          <div class="yearly-stat"><div class="label">月平均</div><div class="value">&yen;${monthAvg.toLocaleString()}</div></div>
        </div>
        ${catBarHtml(g.categories, g.total)}
      </div>
      <div class="group-record-list hidden" data-year-detail="${y}">
        ${recordListHtml(recordsByYear[y] || [], y)}
      </div>
    </div>`;
  }).join('');

  // クリックで展開/折りたたみ
  container.querySelectorAll('.yearly-header').forEach(header => {
    header.addEventListener('click', () => {
      const card = header.closest('.yearly-summary-card');
      const y = card.dataset.year;
      const detail = card.querySelector(`[data-year-detail="${y}"]`);
      const icon = header.querySelector('.expand-icon');
      detail.classList.toggle('hidden');
      icon.textContent = detail.classList.contains('hidden') ? '\u25B6' : '\u25BC';
    });
  });

  // 明細クリックで編集
  container.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = item.dataset.groupKey;
      const idx = Number(item.dataset.ridx);
      if (recordsByYear[key] && recordsByYear[key][idx]) openEditModal(recordsByYear[key][idx]);
    });
  });
}

// 保存成功後に履歴も更新
const originalAddToHistory = addToHistory;
addToHistory = function(record) {
  originalAddToHistory(record);
  setTimeout(fetchAllHistory, 2000);
};

// 初期読み込み
updateSheetLink();
if (getGasUrl()) fetchAllHistory();

// アプリに戻った時に自動更新
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && getGasUrl()) fetchAllHistory();
});

// --- CSV Import ---
const csvFileInput = document.getElementById('csvFileInput');
const csvPreview = document.getElementById('csvPreview');
const csvPreviewContent = document.getElementById('csvPreviewContent');
const csvImportBtn = document.getElementById('csvImportBtn');
let csvParsedRows = [];

csvFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { showToast('CSVにデータがありません', 'error'); return; }
    csvParsedRows = lines;
    const preview = lines.slice(0, 6).map(l => `<div style="font-size:0.75rem;padding:4px 0;border-bottom:1px solid var(--border);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l)}</div>`).join('');
    csvPreviewContent.innerHTML = `<div style="font-size:0.8125rem;font-weight:600;margin-bottom:4px">${lines.length - 1}件のデータ</div>${preview}${lines.length > 6 ? '<div style="font-size:0.75rem;color:var(--text-muted)">...他 ' + (lines.length - 6) + ' 件</div>' : ''}`;
    csvPreview.classList.remove('hidden');
  };
  reader.readAsText(file, 'UTF-8');
});

csvImportBtn.addEventListener('click', async () => {
  if (csvParsedRows.length < 2) return;
  const apiKey = getApiKey();
  if (!apiKey) { showToast('API Keyを設定してください', 'error'); return; }
  const gasUrl = getGasUrl();
  if (!gasUrl) { showToast('GAS URLを設定してください', 'error'); return; }

  csvImportBtn.disabled = true;
  csvImportBtn.textContent = 'AIが分類中...';

  const csvText = csvParsedRows.join('\n');
  const today = new Date().toISOString().split('T')[0];

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `以下のCSVデータはクレジットカードや銀行の明細です。各行を解析して、JSON配列で返してください（前置き・後書きなし）。
1行目はヘッダーです。日付・店舗名（利用先）・金額の列を自動検出してください。

各レコードのフォーマット:
{"date":"YYYY-MM-DD","store":"店舗名","amount":数値（正の整数）,"category":"勘定科目","memo":""}

勘定科目: 消耗品費/旅費交通費/通信費/接待交際費/会議費/新聞図書費/地代家賃/水道光熱費/外注工賃/広告宣伝費/福利厚生費/雑費/その他
金額が負数（返金）の行はスキップ。日付が不明なら${today}。

CSV:
${csvText.substring(0, 6000)}`
        }]
      })
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    const respText = data.content[0].text.trim();
    const jsonMatch = respText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('JSON配列を抽出できませんでした');

    const records = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(records) || records.length === 0) throw new Error('レコードが空です');

    csvImportBtn.textContent = `${records.length}件を保存中...`;

    // 順番に保存
    let saved = 0;
    for (const rec of records) {
      const amount = Number(rec.amount) || 0;
      if (amount <= 0) continue;
      const exTax = Math.round(amount / 1.10);
      const saveData = {
        date: rec.date || today,
        store: rec.store || '不明',
        amount: amount,
        category: rec.category || '雑費',
        taxRate: '10%',
        payment: 'クレジットカード',
        invoice: '',
        memo: rec.memo || '',
        expenseType: '事業',
        proration: 100,
        exTax: exTax,
        tax: amount - exTax,
        businessAmount: amount
      };
      await fetch(gasUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify(saveData) });
      saved++;
    }

    showToast(`${saved}件をインポートしました`);
    csvPreview.classList.add('hidden');
    csvParsedRows = [];
    csvFileInput.value = '';
    setTimeout(fetchAllHistory, 2000);
  } catch (err) {
    console.error('CSVインポートエラー:', err);
    showToast('インポート失敗: ' + err.message, 'error');
  } finally {
    csvImportBtn.disabled = false;
    csvImportBtn.textContent = 'AIで分類して一括取込';
  }
});

// --- Edit/Delete Records ---
const editModal = document.getElementById('editModal');
const closeEditModalBtn = document.getElementById('closeEditModalBtn');
const editSaveBtn = document.getElementById('editSaveBtn');
const editDeleteBtn = document.getElementById('editDeleteBtn');
let editingRecord = null;

function openEditModal(record) {
  editingRecord = record;
  document.getElementById('editStore').value = record.store || '';
  document.getElementById('editDate').value = record.date ? String(record.date).substring(0, 10) : '';
  document.getElementById('editAmount').value = record.amount || '';
  document.getElementById('editCategory').value = record.category || '雑費';
  document.getElementById('editMemo').value = record.memo || '';
  document.getElementById('editExpenseType').value = record.expenseType || '事業';
  // proration: "100%" 形式の文字列か数値が来る
  const pr = record.proration;
  const prNum = typeof pr === 'number' ? pr : (pr ? parseInt(String(pr)) : 100);
  document.getElementById('editProration').value = isNaN(prNum) ? 100 : prNum;
  editModal.classList.remove('hidden');
}

function closeEditModal() {
  editModal.classList.add('hidden');
  if (editingWeeklyIdx >= 0) {
    editingWeeklyIdx = -1;
    editSaveBtn.textContent = '更新';
    editDeleteBtn.textContent = '削除';
  }
}
closeEditModalBtn.addEventListener('click', closeEditModal);
editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });

// 経費区分の変更で按分率を自動連動
document.getElementById('editExpenseType').addEventListener('change', (e) => {
  const v = e.target.value;
  const prInput = document.getElementById('editProration');
  if (v === '事業') prInput.value = 100;
  else if (v === '個人') prInput.value = 0;
});

editSaveBtn.addEventListener('click', async () => {
  // 週次レビュー候補の編集モード
  if (editingWeeklyIdx >= 0 && weeklyCandidates[editingWeeklyIdx]) {
    const c = weeklyCandidates[editingWeeklyIdx];
    c.store = document.getElementById('editStore').value;
    c.date = document.getElementById('editDate').value;
    c.amount = Number(document.getElementById('editAmount').value) || 0;
    c.category = document.getElementById('editCategory').value;
    c.memo = document.getElementById('editMemo').value;
    editingWeeklyIdx = -1;
    editSaveBtn.textContent = '更新';
    editDeleteBtn.textContent = '削除';
    editModal.classList.add('hidden');
    renderWeeklyList();
    return;
  }

  if (!editingRecord) return;
  const gasUrl = getGasUrl();
  if (!gasUrl) { showToast('GAS URLを設定してください', 'error'); return; }

  const newAmount = Number(document.getElementById('editAmount').value) || 0;
  const newExpenseType = document.getElementById('editExpenseType').value;
  let newProration = Math.min(100, Math.max(0, Number(document.getElementById('editProration').value) || 0));
  // 区分の連動：事業=100、個人=0、家事按分は手入力値そのまま
  if (newExpenseType === '事業') newProration = 100;
  else if (newExpenseType === '個人') newProration = 0;
  const newBusinessAmount = Math.round(newAmount * newProration / 100);
  const updated = {
    date: document.getElementById('editDate').value,
    store: document.getElementById('editStore').value,
    amount: newAmount,
    category: document.getElementById('editCategory').value,
    taxRate: editingRecord.taxRate || '',
    payment: editingRecord.payment || '',
    invoice: editingRecord.invoice || '',
    memo: document.getElementById('editMemo').value,
    expenseType: newExpenseType,
    proration: newProration,
    exTax: Math.round(newAmount / 1.10),
    tax: newAmount - Math.round(newAmount / 1.10),
    businessAmount: newBusinessAmount
  };

  editSaveBtn.disabled = true;
  editSaveBtn.textContent = '更新中...';
  try {
    await fetch(gasUrl, {
      method: 'POST', mode: 'no-cors',
      body: JSON.stringify({
        action: 'update',
        date: String(editingRecord.date),
        store: String(editingRecord.store),
        amount: Number(editingRecord.amount),
        createdAt: String(editingRecord.createdAt),
        updated: updated
      })
    });
    // ローカルの allRecords も即時更新
    const idx = allRecords.findIndex(r =>
      String(r.store) === String(editingRecord.store) &&
      Number(r.amount) === Number(editingRecord.amount) &&
      String(r.date).substring(0,10) === String(editingRecord.date).substring(0,10)
    );
    if (idx >= 0) {
      allRecords[idx] = { ...allRecords[idx], ...updated };
    }
    applyFilters();
    refreshTabView();
    showToast('更新しました');
    editModal.classList.add('hidden');
    setTimeout(fetchAllHistory, 3000);
  } catch (err) {
    showToast('更新失敗: ' + err.message, 'error');
  } finally {
    editSaveBtn.disabled = false;
    editSaveBtn.textContent = '更新';
  }
});

editDeleteBtn.addEventListener('click', async () => {
  // 週次レビューの編集中は「キャンセル」として動作
  if (editingWeeklyIdx >= 0) {
    editingWeeklyIdx = -1;
    editSaveBtn.textContent = '更新';
    editDeleteBtn.textContent = '削除';
    editModal.classList.add('hidden');
    return;
  }
  if (!editingRecord) return;
  if (!confirm('この記録を削除しますか？')) return;
  const gasUrl = getGasUrl();
  if (!gasUrl) { showToast('GAS URLを設定してください', 'error'); return; }

  editDeleteBtn.disabled = true;
  editDeleteBtn.textContent = '削除中...';
  try {
    await fetch(gasUrl, {
      method: 'POST', mode: 'no-cors',
      body: JSON.stringify({
        action: 'delete',
        date: String(editingRecord.date),
        store: String(editingRecord.store),
        amount: Number(editingRecord.amount),
        createdAt: String(editingRecord.createdAt)
      })
    });
    // ローカルの allRecords から即時削除
    const delIdx = allRecords.findIndex(r =>
      String(r.store) === String(editingRecord.store) &&
      Number(r.amount) === Number(editingRecord.amount) &&
      String(r.date).substring(0,10) === String(editingRecord.date).substring(0,10)
    );
    if (delIdx >= 0) allRecords.splice(delIdx, 1);
    applyFilters();
    refreshTabView();
    showToast('削除しました');
    editModal.classList.add('hidden');
    setTimeout(fetchAllHistory, 3000);
  } catch (err) {
    showToast('削除失敗: ' + err.message, 'error');
  } finally {
    editDeleteBtn.disabled = false;
    editDeleteBtn.textContent = '削除';
  }
});

// --- 複式簿記・仕訳帳 ---
const PAYMENT_ACCOUNT_MAP = {
  '現金': '現金',
  'クレジットカード': '未払金',
  '電子マネー': '現金',
  'QRコード決済': '現金',
  '銀行振込': '普通預金',
  'その他': '現金',
  '不明': '現金'
};

function generateJournalEntries(records) {
  return records.map(r => {
    const amount = Number(r.businessAmount) || Number(r.amount) || 0;
    if (amount <= 0) return null;
    const debitAccount = r.category || '雑費';
    const creditAccount = PAYMENT_ACCOUNT_MAP[r.payment] || '現金';
    const description = (r.store || '') + (r.memo ? ' ' + r.memo : '');
    return {
      date: formatDate(r.date),
      debitAccount,
      debitAmount: amount,
      creditAccount,
      creditAmount: amount,
      description
    };
  }).filter(Boolean);
}

const journalYear = document.getElementById('journalYear');
const journalCsvBtn = document.getElementById('journalCsvBtn');
const journalPreview = document.getElementById('journalPreview');

function renderJournalView() {
  if (!journalYear || !journalPreview) return;
  // 年ドロップダウンを更新
  const years = [...new Set(allRecords.map(r => extractYear(r.date)).filter(Boolean))].sort().reverse();
  const currentVal = journalYear.value;
  journalYear.innerHTML = years.map(y => `<option value="${y}"${y === currentVal ? ' selected' : ''}>${y}年度</option>`).join('');
  if (!journalYear.value && years.length > 0) journalYear.value = years[0];

  const selectedYear = journalYear.value;
  if (!selectedYear) {
    journalPreview.innerHTML = '<p class="history-empty">データがありません</p>';
    return;
  }

  const filtered = allRecords
    .filter(r => extractYear(r.date) === selectedYear)
    .sort((a, b) => String(a.date) < String(b.date) ? -1 : 1);
  const entries = generateJournalEntries(filtered);

  if (entries.length === 0) {
    journalPreview.innerHTML = '<p class="history-empty">該当する仕訳がありません</p>';
    return;
  }

  const totalAmount = entries.reduce((s, e) => s + e.debitAmount, 0);

  const rows = entries.map(e => `<tr>
    <td>${escapeHtml(e.date)}</td>
    <td>${escapeHtml(e.debitAccount)}</td>
    <td class="amount">&yen;${e.debitAmount.toLocaleString()}</td>
    <td>${escapeHtml(e.creditAccount)}</td>
    <td class="amount">&yen;${e.creditAmount.toLocaleString()}</td>
    <td>${escapeHtml(e.description)}</td>
  </tr>`).join('');

  journalPreview.innerHTML = `<table class="journal-table">
    <thead><tr><th>日付</th><th>借方科目</th><th>借方金額</th><th>貸方科目</th><th>貸方金額</th><th>摘要</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>合計</td><td></td><td class="amount">&yen;${totalAmount.toLocaleString()}</td><td></td><td class="amount">&yen;${totalAmount.toLocaleString()}</td><td>${entries.length}件</td></tr></tfoot>
  </table>`;
}

if (journalYear) journalYear.addEventListener('change', renderJournalView);

if (journalCsvBtn) journalCsvBtn.addEventListener('click', () => {
  const selectedYear = journalYear.value;
  if (!selectedYear) { showToast('年度を選択してください', 'error'); return; }
  const filtered = allRecords
    .filter(r => extractYear(r.date) === selectedYear)
    .sort((a, b) => String(a.date) < String(b.date) ? -1 : 1);
  const entries = generateJournalEntries(filtered);
  if (entries.length === 0) { showToast('仕訳データがありません', 'error'); return; }

  const header = '日付,借方科目,借方金額,貸方科目,貸方金額,摘要';
  const csvRows = entries.map(e =>
    `${e.date},${e.debitAccount},${e.debitAmount},${e.creditAccount},${e.creditAmount},"${e.description.replace(/"/g, '""')}"`
  );
  const csv = '\uFEFF' + header + '\n' + csvRows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `仕訳帳_${selectedYear}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`仕訳帳_${selectedYear}.csv をダウンロードしました`);
});

// --- Service Worker ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
