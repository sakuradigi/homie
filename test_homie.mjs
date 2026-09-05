// Homie 作業通 — index.html 行為測試（jsdom，開發用，不影響網站本體）
// 執行方式：npm i jsdom dompurify && node test_homie.mjs
// 用途：改完 index.html 後跑一次，確認提示詞、歷史紀錄、三家 API 參數都沒被改壞
import fs from 'fs';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

const SRC = process.env.HOMIE_HTML || new URL('./index.html', import.meta.url).pathname;
const raw = fs.readFileSync(SRC, 'utf8');
// 沙箱不連外網：移除 CDN script，改用本地 stub
const html = raw.replace(/<script src="https:\/\/cdnjs[^"]*"><\/script>/g, '');

const dom = new JSDOM(html, {
  pretendToBeVisual: true,
  url: 'https://sakuradigi.github.io/homie/',
  runScripts: 'outside-only'      // window.eval 在 window 環境內執行
});
const win = dom.window;
win.DOMPurify = createDOMPurify(win);
win.marked = { parse: (t) => '<p>' + t + '</p>' };
win.alert = (m) => { win.__alert = m; };
win.scrollTo = () => {};
win.HTMLElement.prototype.scrollIntoView = () => {};

const pageScript = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
// 測試驅動程式必須與頁面 script 在同一次 eval，才能存取 let 宣告的變數
win.eval(pageScript + `
;const __realCallAI = callAI;
window.__T = {
  setImages: (n) => { hwImages = Array.from({length:n}, () => ({ mime:'image/jpeg', dataUrl:'data:image/jpeg;base64,AAA' })); },
  stubCallAI: (fn) => { callAI = fn; },
  callReal: (...a) => __realCallAI(...a),
  setProvider: (p) => { currentProvider = p; },
  truncated: () => lastResponseTruncated
};`);

const T = win.__T;
const results = [];
const check = (name, cond, extra = '') =>
  results.push((cond ? 'PASS  ' : '**FAIL** ') + name + (extra ? '  → ' + extra : ''));

// ── 1. 補充提示輸入框 UI ──────────────────────────────
const input = win.document.getElementById('hwHint');
const clearBtn = win.document.getElementById('hwHintClear');
check('提示輸入框存在且在科目區下方', !!input && !!win.document.querySelector('.subject-row ~ .hint-row'));
check('清除鈕預設隱藏', clearBtn.style.display === 'none');
input.value = '  這是童詩作業，幫忙提點  ';
win.updateHintUI();
check('輸入後清除鈕出現', clearBtn.style.display === 'flex');
check('getHint 去除前後空白', win.getHint() === '這是童詩作業，幫忙提點', JSON.stringify(win.getHint()));
check('maxlength 限制 120 字', input.getAttribute('maxlength') === '120');
check('字級 16px（防 iOS 聚焦自動縮放）', /\.hint-input\s*\{[^}]*font-size:\s*16px/.test(html));

// ── 2. prompt 組裝 ───────────────────────────────────
let captured = null;
T.setImages(1);
T.stubCallAI(async (prompt) => { captured = prompt; return '## 需要訂正\n- 第3題 → <mark>8</mark>'; });
await win.runHomework();
check('prompt 帶入家長補充說明', captured.includes('家長補充說明：「這是童詩作業，幫忙提點」'));
check('prompt 含「需要訂正」摘要段', captured.includes('## 需要訂正'));
check('prompt 保留 mark 標記規則', captured.includes('<mark>'));
check('prompt 頁數正確', captured.includes('這1頁作業圖片'));

win.clearHint();
check('clearHint 清空欄位與按鈕', input.value === '' && clearBtn.style.display === 'none');
await win.runHomework();
check('未填提示時 prompt 不含補充說明', !captured.includes('家長補充說明'));

// ── 3. 結果卡 ────────────────────────────────────────
win.document.getElementById('hwResults').innerHTML = '';
win.renderHomeworkResult('測試內容', '童詩<script>alert(1)</script>', false);
const tag = win.document.querySelector('.hint-tag');
check('結果卡顯示這次套用的提示', !!tag && tag.textContent.includes('童詩'));
check('提示標籤不會注入 HTML', !win.document.querySelector('.hint-tag script'));

// ── 4. 截斷警告 ──────────────────────────────────────
win.document.getElementById('hwResults').innerHTML = '';
win.renderHomeworkResult('內容', '', true);
check('截斷時顯示警告', !!win.document.querySelector('.notice-box'));
win.document.getElementById('hwResults').innerHTML = '';
win.renderHomeworkResult('內容', '', false);
check('未截斷時不顯示警告', !win.document.querySelector('.notice-box'));

// ── 5. 歷史紀錄 ──────────────────────────────────────
win.localStorage.clear();
win.saveHistory('hw', '## 標題\n正確答案是 <mark>8</mark>（不是 9）', null, '童詩作業');
const saved = JSON.parse(win.localStorage.getItem('homie_hw_history'))[0];
check('preview 去除 HTML 標籤', !saved.preview.includes('<mark'), saved.preview);
check('preview 去除 markdown 記號', !saved.preview.includes('#'), saved.preview);
check('歷史存下提示詞', saved.hint === '童詩作業');
win.loadHistoryUI('hw');
check('歷史列表顯示提示詞', win.document.querySelector('.h-meta').textContent.includes('童詩作業'));

// ── 6. 舊資料相容（沒有 hint 欄位）────────────────────
win.localStorage.setItem('homie_hw_history', JSON.stringify([
  { ts: Date.now(), subject: '數學', preview: '## 舊資料 <mark>8</mark>', full: '舊內容', readLang: null }
]));
win.loadHistoryUI('hw');
const oldMeta = win.document.querySelector('.h-meta').textContent;
const oldPrev = win.document.querySelector('.h-preview').textContent;
check('舊紀錄不會出現 undefined', oldMeta.includes('數學') && !oldMeta.includes('undefined'), oldMeta);
check('舊紀錄 preview 也清乾淨', !oldPrev.includes('<mark') && !oldPrev.includes('#'), oldPrev);
win.restoreHistory('hw', JSON.parse(win.localStorage.getItem('homie_hw_history'))[0]);
check('舊紀錄可正常還原', win.document.querySelector('#hwResults .md-body').textContent.includes('舊內容'));

// ── 7. 新題目重置 ────────────────────────────────────
input.value = '殘留提示';
win.resetPanel('hw');
check('「新題目」會清掉提示', input.value === '');

// ── 8. API 參數與串流解析 ────────────────────────────
const sse = (payload) => ({
  ok: true,
  body: { getReader: () => { let done = false; return { read: async () =>
    done ? { done: true } : (done = true, { done: false, value: new TextEncoder().encode('data: ' + payload + '\n\n') })
  }; } }
});
const bodies = [];

// OpenAI：GPT-5 系列必須用 max_completion_tokens
win.fetch = async (url, opt) => { bodies.push({ url, body: JSON.parse(opt.body) });
  return sse('{"choices":[{"delta":{"content":"hi"},"finish_reason":"length"}]}'); };
win.localStorage.setItem('homie_openai_key', 'sk-test');
T.setProvider('openai');
win.switchProvider('openai', true);
const outText = await T.callReal('p', [], null);
const ob = bodies[0].body;
check('GPT-5 用 max_completion_tokens 而非 max_tokens',
  ob.max_completion_tokens > 0 && ob.max_tokens === undefined,
  JSON.stringify({ max_completion_tokens: ob.max_completion_tokens, max_tokens: ob.max_tokens }));
check('OpenAI 串流內容正確', outText === 'hi');
check('OpenAI finish_reason=length 判定為截斷', T.truncated() === true);

// Gemini：思考內容過濾、MAX_TOKENS 偵測、額度上限
bodies.length = 0;
win.fetch = async (url, opt) => { bodies.push({ url, body: JSON.parse(opt.body) });
  return sse('{"candidates":[{"content":{"parts":[{"text":"我在想…","thought":true},{"text":"答案是 8"}]},"finishReason":"MAX_TOKENS"}]}'); };
win.localStorage.setItem('homie_gemini_key', 'AIza-test');
T.setProvider('gemini');
win.switchProvider('gemini', true);
const gText = await T.callReal('p', [], null);
check('Gemini 過濾思考內容、只留答案', gText === '答案是 8', JSON.stringify(gText));
check('Gemini maxOutputTokens 提高為 32768', bodies[0].body.generationConfig.maxOutputTokens === 32768);
check('Gemini MAX_TOKENS 判定為截斷', T.truncated() === true);
check('Gemini 走預設模型 3.8 Flash', bodies[0].url.includes('gemini-3.8-flash'), bodies[0].url);

// 每次呼叫應重置截斷旗標
win.fetch = async () => sse('{"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}');
await T.callReal('p', [], null);
check('新呼叫會重置截斷旗標', T.truncated() === false);

// Claude：max_tokens 用法不變 + stop_reason 偵測
bodies.length = 0;
win.fetch = async (url, opt) => { bodies.push({ url, body: JSON.parse(opt.body) });
  return sse('{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}'); };
win.localStorage.setItem('homie_claude_key', 'sk-ant-test');
T.setProvider('claude');
win.switchProvider('claude', true);
await T.callReal('p', [], null);
check('Claude 仍使用 max_tokens', bodies[0].body.max_tokens > 0);
check('Claude stop_reason=max_tokens 判定為截斷', T.truncated() === true);

console.log(results.join('\n'));
const pass = results.filter(r => r.startsWith('PASS')).length;
console.log('\n' + pass + '/' + results.length + ' 通過');
if (pass !== results.length) process.exit(1);
