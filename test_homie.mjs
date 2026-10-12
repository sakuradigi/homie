// Homie 作業通 — index.html 行為測試（jsdom，開發用，不影響網站本體）
// 執行方式：npm i --no-save jsdom dompurify fake-indexeddb && node test_homie.mjs
// 用途：改完 index.html 後跑一次，確認提示詞、歷史紀錄、三家 API 參數都沒被改壞
import fs from 'fs';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { indexedDB as fakeIDB } from 'fake-indexeddb';

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
win.indexedDB = fakeIDB;   // 錯題本用 IndexedDB，測試時換成記憶體版
win.marked = { parse: (t) => '<p>' + t + '</p>' };
win.alert = (m) => { win.__alert = m; };
win.scrollTo = () => {};
win.HTMLElement.prototype.scrollIntoView = () => {};

// 模擬語音合成：cancel() 會「非同步補發 onend」，重現 Safari／部分 Chrome 的行為（停止 bug 的根因）
const spoken = [];
let curU = null;
const VOICES = [
  { name: 'Chinese China', lang: 'zh_CN', localService: true },
  { name: 'Google 國語（臺灣）', lang: 'zh_TW', localService: false },
  { name: 'Microsoft HsiaoChen Online (Natural) - Chinese (Taiwan)', lang: 'zh-TW', localService: false },
  { name: '粵語', lang: 'zh-HK', localService: true },
  { name: 'Bells', lang: 'en-US', localService: true },
  { name: 'Samantha', lang: 'en-US', localService: true }
];
win.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
win.speechSynthesis = {
  speaking: false, pending: false,
  getVoices: () => VOICES,
  speak(u) { spoken.push(u.text); curU = u; this.speaking = true; },
  cancel() { const u = curU; curU = null; this.speaking = false; if (u) setTimeout(() => u.onend && u.onend(), 0); },
  finish() { const u = curU; curU = null; this.speaking = false; if (u && u.onend) u.onend(); },
  current: () => curU
};
// 模擬 <audio>：記錄播放過的 src，測試裡手動觸發 onended
const played = [];
win.Audio = class { constructor() { this.src = ''; } play() { if (!this.src.startsWith('data:')) played.push(this.src); return Promise.resolve(); } pause() {} };
let blobN = 0;
const blobs = {};
win.URL.createObjectURL = (b) => { const u = 'blob:' + (++blobN); blobs[u] = b; return u; };
win.URL.revokeObjectURL = () => {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const pageScript = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
// 測試驅動程式必須與頁面 script 在同一次 eval，才能存取 let 宣告的變數
win.eval(pageScript + `
;const __realCallAI = callAI;
window.__T = {
  setImages: (n) => { hwImages = Array.from({length:n}, () => ({ mime:'image/jpeg', dataUrl:'data:image/jpeg;base64,AAA' })); },
  stubCallAI: (fn) => { callAI = fn; },
  callReal: (...a) => __realCallAI(...a),
  setProvider: (p) => { currentProvider = p; },
  truncated: () => lastResponseTruncated,
  state: () => ({ playIdx, isPlaying, len: playlist.length, kinds: playlist.map(p => p.kind) }),
  stubCompress: (fn) => { compressImage = fn; },
  rdImages: () => rdImages,
  audio: () => ttsAudio,
  cacheSize: () => ttsCache.size,
  setRetry: (ms) => { TTS_RETRY_MS = ms; },
  setRdImages: (n) => { rdImages = Array.from({length:n}, () => ({ mime:'image/jpeg', dataUrl:'data:image/jpeg;base64,AAA' })); },
  notes: () => companionNotes,
  utter: () => currentUtterance,
  version: () => APP_VERSION,
  lastCost: () => lastCost,
  wordMode: () => wordMode,
  shadow: () => shadowState
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
check('prompt 要求每題附結構化資料', captured.includes('"status"') && captured.includes('```json'));
check('prompt：空白題不可以直接給答案', captured.includes('孩子沒寫（空白）：不要寫出答案'));
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
check('Claude 預設模型為 Haiku 4.5', bodies[0].body.model === 'claude-haiku-4-5');
check('Haiku 不送備援參數', bodies[0].body.fallbacks === undefined);
check('max_tokens 開到 32000（容納思考 token）', bodies[0].body.max_tokens === 32000);

// Sonnet 5.5：開啟伺服器端備援；串流中途切換時丟掉半截答案
const sseMulti = (payloads) => ({ ok: true, body: { getReader: () => { let done = false; return { read: async () =>
  done ? { done: true } : (done = true, { done: false, value: new TextEncoder().encode(payloads.map(p => 'data: ' + JSON.stringify(p) + '\n\n').join('')) })
}; } } });
bodies.length = 0;
let claudeHeaders = null;
win.fetch = async (url, opt) => { bodies.push({ url, body: JSON.parse(opt.body) }); claudeHeaders = opt.headers;
  return sseMulti([
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '半截' } },
    { type: 'content_block_start', content_block: { type: 'fallback', from: { model: 'claude-sonnet-5-5' }, to: { model: 'claude-sonnet-5' } } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '想一想' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '完整答案' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
  ]); };
win.document.getElementById('modelSelect').value = 'claude-sonnet-5-5';
const fbText = await T.callReal('p', [], null);
check('5.5 系列開啟 fallbacks: default', bodies[0].body.fallbacks === 'default' && claudeHeaders['anthropic-beta'] === 'server-side-fallback-2026-07-01');
check('切換到備援模型時丟掉半截答案、不含思考', fbText === '完整答案', JSON.stringify(fbText));

win.fetch = async () => sseMulti([{ type: 'message_delta', delta: { stop_reason: 'refusal' } }]);
let refusalErr = null;
try { await T.callReal('p', [], null); } catch (e) { refusalErr = e.message; }
check('拒答時顯示清楚的錯誤', !!refusalErr && refusalErr.includes('安全機制'), String(refusalErr));


// ── 9. 繪本：切句 ────────────────────────────────────
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let r9 = win.splitSentences('小熊說：「我好餓。」他走進森林。');
check('中文切句、引號跟著前一句', eq(r9, ['小熊說：「我好餓。」', '他走進森林。']), JSON.stringify(r9));
r9 = win.splitSentences('The bear was hungry. He walked into the woods!');
check('英文切句', eq(r9, ['The bear was hungry.', 'He walked into the woods!']), JSON.stringify(r9));
r9 = win.splitSentences('嗯。好吧，我們走吧。');
check('太短的句子併到下一句', eq(r9, ['嗯。好吧，我們走吧。']), JSON.stringify(r9));
r9 = win.splitSentences('Once upon a time');
check('沒有標點的整段保留', eq(r9, ['Once upon a time']), JSON.stringify(r9));
r9 = win.splitSentences('It costs 3.5 dollars. OK then, we go.');
check('小數點不會被切開', r9[0] === 'It costs 3.5 dollars.', JSON.stringify(r9));

// ── 10. 繪本：渲染與播放器 ────────────────────────────
const BOOK = '===第1頁===\n小熊說：「我好餓。」他走進森林。\n森林裡好安靜喔。小鳥都睡著了。\n===第2頁===\n（本頁無文字）';
win.localStorage.clear();
win.renderReadingResult(BOOK, 'zh');
const segs = win.document.querySelectorAll('#rdResults .para-segment');
check('每一句都是可點的片段', segs.length === 4, String(segs.length));
check('「本頁無文字」只顯示不唸', !!win.document.querySelector('.para.empty') && T.state().len === 4);
check('播放器出現在結果最上方', win.document.querySelector('#rdResults').firstElementChild.id === 'rdPlayer');
check('提示可以點句子', win.document.getElementById('plStatus').textContent.includes('點任一句'));

// 停止後不會又自己唸起來（cancel 補發的 onend 必須被忽略）
spoken.length = 0;
win.playFrom(0);
check('播放從第 1 句開始', spoken[0] === '小熊說：「我好餓。」');
win.stopTTS();
await sleep(150);
check('按停止後不會再唸下一句', spoken.length === 1, JSON.stringify(spoken));
check('停止後位置歸零', T.state().playIdx === -1 && !T.state().isPlaying);

// 唸到一半點別句：從那句開始，不跳句
spoken.length = 0;
win.playFrom(0);
segs[2].click();
await sleep(150);
check('點第 3 句就從第 3 句唸', spoken[spoken.length - 1] === '森林裡好安靜喔。', JSON.stringify(spoken));
check('點句後沒有跳句', T.state().playIdx === 2 && spoken.length === 2, JSON.stringify({ s: spoken, i: T.state().playIdx }));
check('目前句子有高亮', segs[2].classList.contains('active') && !segs[0].classList.contains('active'));

// 暫停記住位置，繼續從同一句重唸
win.speechSynthesis.finish();          // 第 3 句唸完 → 自動接第 4 句
check('唸完自動接下一句', spoken[spoken.length - 1] === '小鳥都睡著了。');
win.togglePlay();                       // 暫停
await sleep(150);
check('暫停後保留位置', T.state().playIdx === 3 && !T.state().isPlaying);
check('暫停後按鈕顯示「繼續」', win.document.getElementById('plPlay').textContent.includes('繼續'));
const before = spoken.length;
win.togglePlay();                       // 繼續
await sleep(150);
check('繼續會從暫停的那句重唸', spoken.length === before + 1 && spoken[spoken.length - 1] === '小鳥都睡著了。', JSON.stringify(spoken));
win.speechSynthesis.finish();
check('整本唸完回到起點', T.state().playIdx === -1 && !T.state().isPlaying);

// 上一句／下一句（暫停中只移動位置不出聲）
win.stopTTS(); await sleep(50);
spoken.length = 0;
win.skipItem(1); win.skipItem(1);
check('暫停中按下一句只移動位置', T.state().playIdx === 1 && spoken.length === 0);
win.skipItem(-1);
check('上一句', T.state().playIdx === 0);

// ── 11. 語音挑選 ─────────────────────────────────────
check('Android 底線語系（zh_TW）也認得', win.voicesFor('zh').length === 4);
check('中文自動挑台灣 Natural 語音', win.pickBrowserVoice('zh').name.includes('HsiaoChen'), win.pickBrowserVoice('zh').name);
check('英文不會挑到搞笑語音 Bells', win.pickBrowserVoice('en').name === 'Samantha');
check('粵語排最後', win.voicesFor('zh').slice(-1)[0].lang === 'zh-HK');
win.document.getElementById('ttsVoice').value = 'Chinese China';
win.onVoiceChange();
check('手動選的語音會被記住', win.pickBrowserVoice('zh').name === 'Chinese China');
win.document.getElementById('ttsSpeed').value = '0.85';
win.onSpeedChange();
win.renderReadingResult(BOOK, 'zh');
check('語速重開後仍記得', win.document.getElementById('ttsSpeed').value === '0.85');
check('語音重開後仍記得', win.document.getElementById('ttsVoice').value === 'Chinese China');

// ── 12. 多張照片依選取順序加入 ─────────────────────────
win.clearImages('rd');
T.stubCompress((f) => new Promise(r => setTimeout(() => r({ mime: 'image/jpeg', dataUrl: 'data:,' + f.name }), f.delay)));
await win.addImages([{ name: 'P1', delay: 60 }, { name: 'P2', delay: 5 }, { name: 'P3', delay: 30 }], 'rd');
check('壓縮快慢不同，頁序仍照選取順序', T.rdImages().map(i => i.dataUrl).join() === 'data:,P1,data:,P2,data:,P3', T.rdImages().map(i => i.dataUrl).join());

// ── 13. AI 自然語音 ─────────────────────────────────
win.localStorage.clear();
win.renderReadingResult(BOOK, 'zh');
const engSel = win.document.getElementById('ttsEngine');
check('沒有 Key 時 AI 語音選項停用', [...engSel.options].filter(o => o.disabled).length === 2 && engSel.value === 'browser');

win.localStorage.setItem('homie_gemini_key', 'AIza-test');
win.renderReadingResult(BOOK, 'zh');
check('有 Gemini Key 時預設用 Gemini AI 語音', win.document.getElementById('ttsEngine').value === 'gemini');
check('語音選單換成 Gemini 音色', win.document.getElementById('ttsVoice').options[0].value === 'Sulafat');

// Gemini 回傳 base64 PCM（無檔頭）
const pcm = new Uint8Array(480);   // 10ms 靜音
const pcmB64 = Buffer.from(pcm).toString('base64');
const ttsCalls = [];
win.fetch = async (url, opt) => {
  ttsCalls.push({ url, headers: opt.headers, body: JSON.parse(opt.body) });
  return { ok: true, status: 200, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: pcmB64 }] }] }) };
};
played.length = 0;
win.playFrom(0);
await sleep(30);
const g = ttsCalls[0];
check('Gemini TTS 端點與模型', g.url.endsWith('/v1beta/interactions') && g.body.model === 'gemini-3.8-flash-tts', g.url + ' ' + g.body.model);
check('Gemini Key 放在 header', g.headers['x-goog-api-key'] === 'AIza-test');
check('Gemini 帶音色與台灣口音語氣', g.body.generation_config.speech_config[0].voice === 'Sulafat' &&
  g.body.input[0].content[0].annotations[0].style.includes('台灣國語'));
check('Gemini 送的是原文句子', g.body.input[0].content[0].text === '小熊說：「我好餓。」');
check('有開始播放音檔', played.length === 1);
const wav = blobs[played[0]];
const head = new Uint8Array(await wav.arrayBuffer());
check('原始 PCM 補上 WAV 檔頭', wav.type === 'audio/wav' && String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && head.length === 44 + 480);
check('WAV 檔頭取樣率 24kHz', new DataView(head.buffer).getUint32(24, true) === 24000);
check('播放時預先產生後兩句', ttsCalls.length === 3, String(ttsCalls.length));

// 唸完自動接下一句，且用的是預先產生好的音檔（不再打 API）
T.audio().onended();
await sleep(30);
check('唸完接下一句', played.length === 2 && T.state().playIdx === 1);
check('下一句直接用快取，不重複呼叫 API', ttsCalls.filter(c => c.body.input[0].content[0].text === '他走進森林。').length === 1);

// 點已經產生過的句子：不再付費
const callsBefore = ttsCalls.length;
win.document.querySelectorAll('#rdResults .para-segment')[0].click();
await sleep(30);
check('重聽同一句不重複產生', ttsCalls.filter(c => c.body.input[0].content[0].text === '小熊說：「我好餓。」').length === 1);

// 暫停：音檔停下、onended 不再接續
win.pausePlayback();
check('暫停後狀態正確', !T.state().isPlaying && T.state().playIdx === 0);

// 429 → 重試成功
T.setRetry(1);
let n429 = 0;
win.fetch = async (url, opt) => {
  ttsCalls.push({ url, body: JSON.parse(opt.body) });
  if (n429++ === 0) return { ok: false, status: 429, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: pcmB64 }] }] }) };
};
played.length = 0;
win.playFrom(3);
await sleep(50);
check('遇到 429 會自動重試', played.length === 1 && T.state().isPlaying, JSON.stringify({ played: played.length, n429 }));
win.pausePlayback();

// 失敗 → 自動改用手機內建語音接著唸
win.renderReadingResult('===第1頁===\n全新的一句話在這裡。', 'zh');
win.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }) });
spoken.length = 0;
win.playFrom(0);
await sleep(30);
check('AI 語音失敗時改用內建語音唸同一句', spoken[0] === '全新的一句話在這裡。', JSON.stringify(spoken));
check('失敗時顯示原因', win.document.getElementById('plNotice').textContent.includes('API key not valid'));
check('失敗只切換畫面、不改存檔設定', win.document.getElementById('ttsEngine').value === 'browser' && win.localStorage.getItem('homie_tts_engine') === null);
win.stopTTS(); await sleep(20);

// OpenAI TTS 參數
win.localStorage.setItem('homie_openai_key', 'sk-test');
win.localStorage.setItem('homie_tts_engine', 'openai');
win.renderReadingResult('===第1頁===\nOpenAI 這一句。', 'zh');
let oa = null;
win.fetch = async (url, opt) => { oa = { url, headers: opt.headers, body: JSON.parse(opt.body) };
  return { ok: true, status: 200, blob: async () => new win.Blob(['x'], { type: 'audio/mpeg' }) }; };
win.playFrom(0);
await sleep(30);
check('OpenAI TTS 端點與模型', oa.url === 'https://api.openai.com/v1/audio/speech' && oa.body.model === 'gpt-4o-mini-tts');
check('OpenAI 預設音色 marin、帶語氣指示', oa.body.voice === 'marin' && oa.body.instructions.includes('台灣國語'));
check('OpenAI 用 Bearer Key', oa.headers.Authorization === 'Bearer sk-test');
win.stopTTS();

// 英文繪本用英文語氣
win.renderReadingResult('===Page 1===\nThe bear is hungry.', 'en');
win.playFrom(0);
await sleep(30);
check('英文繪本用英文說故事語氣', oa.body.instructions.startsWith('Warm'));
win.stopTTS();

// ── 14. 智慧陪讀 ─────────────────────────────────────
win.localStorage.clear();
const BOOK2 = '===第1頁===\n小熊說：「我好餓。」他走進森林。\n森林裡好安靜喔。小鳥都睡著了。';
const NOTES_REPLY = '好的，以下是陪讀內容：\n```json\n[{"after":-1,"type":"talk","text":"今天我們來讀小熊的故事。"},' +
  '{"after":1,"type":"ask","text":"你猜小熊會找到什麼？"},{"after":99,"type":"talk","text":"故事結束囉。"},' +
  '{"after":"x","type":"talk","text":"壞資料"},{"after":2,"type":"talk","text":"<img src=x onerror=alert(1)>"}]\n```';
// 用 runReading 走完整流程，才會建立歷史紀錄
T.setRdImages(1);
let aiCalls = [];
T.stubCallAI(async (prompt, images) => { aiCalls.push({ prompt, images }); return BOOK2; });
await win.runReading();
check('純朗讀模式只有原文', T.state().kinds.every(k => k === 'read') && T.state().len === 4);
win.setReadMode('companion');
check('切到陪讀但還沒產生：提示按鈕', win.document.getElementById('plNotice').textContent.includes('產生陪讀內容'));
check('陪讀設定列顯示', win.document.getElementById('rdPlayer').classList.contains('mode-companion'));
check('預設年級為國小低年級', win.document.getElementById('childGrade').value === 'low');

aiCalls = [];
T.stubCallAI(async (prompt, images) => { aiCalls.push({ prompt, images }); return NOTES_REPLY; });
await win.generateCompanion();
const cp = aiCalls[0];
check('陪讀只送文字、不重送照片', cp.images.length === 0);
check('prompt 帶編號句子', cp.prompt.includes('[0] 小熊說：「我好餓。」') && cp.prompt.includes('[3] 小鳥都睡著了。'));
check('prompt 帶年級', cp.prompt.includes('國小低年級'));
check('中文繪本 prompt 不含英文單字說明', !cp.prompt.includes('brave'));
check('解析容忍 ```json 圍欄與說明文字、濾掉壞資料', T.notes().length === 4, JSON.stringify(T.notes()));
check('超出範圍的句號夾回最後一句', T.notes().some(n => n.after === 3 && n.text === '故事結束囉。'));
const kinds = T.state().kinds.join(',');
check('播放順序：開場→原文→提問→原文…', kinds === 'talk,read,read,ask,read,talk,read,talk', kinds);
const bubbles = win.document.querySelectorAll('#rdResults .teacher-bubble');
check('畫面上出現小老師泡泡', bubbles.length === 4);
check('開場泡泡在第一段之前', win.document.querySelector('#rdResults .result-content').firstElementChild.classList.contains('teacher-bubble'));
check('提問泡泡用不同樣式', win.document.querySelectorAll('#rdResults .teacher-bubble.ask').length === 1);
check('AI 文字不會注入 HTML', !win.document.querySelector('#rdResults .teacher-bubble img'));
check('按鈕變成「重新產生」', win.document.getElementById('cpGenBtn').textContent.includes('重新產生'));

// 播放：小老師講話 → 原文 → … → 提問後停下等回答
spoken.length = 0;
win.playFrom(0);
check('從開場白開始', spoken[0] === '今天我們來讀小熊的故事。');
check('小老師音調稍高（內建語音）', T.utter().pitch > 1);
check('狀態顯示小老師說話中', win.document.getElementById('plStatus').textContent.includes('小老師'));
win.speechSynthesis.finish();
check('接著唸原文', spoken[1] === '小熊說：「我好餓。」' && T.utter().pitch === undefined);
win.speechSynthesis.finish();   // → 第 2 句
win.speechSynthesis.finish();   // → 提問
check('唸到提問', spoken[spoken.length - 1] === '你猜小熊會找到什麼？');
win.speechSynthesis.finish();   // 提問唸完
await sleep(120);
check('提問後自動停下等孩子回答', !T.state().isPlaying && spoken.length === 4, JSON.stringify(spoken));
check('狀態提示換小朋友回答', win.document.getElementById('plStatus').textContent.includes('換小朋友回答'));
check('提問泡泡維持高亮', win.document.querySelector('#rdResults .teacher-bubble.ask').classList.contains('active'));
win.togglePlay();
check('按繼續接著唸下一句原文', spoken[spoken.length - 1] === '森林裡好安靜喔。');
check('句數只算原文', win.document.getElementById('plStatus').textContent.includes('/ 4 句'));
win.pausePlayback(); await sleep(50);

// 切回純朗讀：泡泡消失、位置保留在同一句原文
win.setReadMode('plain');
check('切回純朗讀泡泡消失', win.document.querySelectorAll('#rdResults .teacher-bubble').length === 0);
check('切換模式保留目前句子', T.state().playIdx === 2, String(T.state().playIdx));
win.setReadMode('companion');
check('再切回陪讀不必重新產生', win.document.querySelectorAll('#rdResults .teacher-bubble').length === 4 && aiCalls.length === 1);

// 存進歷史，還原時直接帶出陪讀內容
const rdHist = JSON.parse(win.localStorage.getItem('homie_rd_history'))[0];
check('陪讀內容存進歷史紀錄', rdHist.companion && rdHist.companion.notes.length === 4 && rdHist.companion.count === 4);
win.loadHistoryUI('rd');
check('歷史列表標示有陪讀', win.document.querySelector('#rdHistoryList .h-meta').textContent.includes('有陪讀'));
win.document.getElementById('rdResults').innerHTML = '';
win.restoreHistory('rd', rdHist);
check('還原歷史直接有陪讀泡泡、不再呼叫 AI', win.document.querySelectorAll('#rdResults .teacher-bubble').length === 4 && aiCalls.length === 1);
// 句數對不上（例如切句規則改過）就不套用舊陪讀內容
win.restoreHistory('rd', { ...rdHist, companion: { ...rdHist.companion, count: 99 } });
check('句數對不上時不套用舊陪讀內容', win.document.querySelectorAll('#rdResults .teacher-bubble').length === 0);

// 格式錯誤
T.stubCallAI(async () => '抱歉，我無法完成');
await win.generateCompanion();
check('回覆格式錯誤時顯示提示', win.document.getElementById('plNotice').textContent.includes('格式不對'));

// 英文繪本：小老師用中文、帶英文單字
win.renderReadingResult('===Page 1===\nThe bear was brave. He walked into the woods.', 'en');
aiCalls = [];
T.stubCallAI(async (prompt, images) => { aiCalls.push({ prompt }); return '[{"after":0,"type":"talk","text":"brave 就是勇敢的意思。"}]'; });
await win.generateCompanion();
check('英文繪本 prompt 要求中文解釋英文單字', aiCalls[0].prompt.includes('英文繪本') && aiCalls[0].prompt.includes('brave 就是勇敢'));
spoken.length = 0;
win.playFrom(0);
check('英文原文用英文語音', T.utter().lang === 'en-US');
win.speechSynthesis.finish();
check('小老師講解用中文語音', T.utter().lang === 'zh-TW' && spoken[1] === 'brave 就是勇敢的意思。');
win.stopTTS(); await sleep(20);

// AI 語音：小老師換一個聲音與語氣
win.localStorage.setItem('homie_gemini_key', 'AIza-test');
win.localStorage.setItem('homie_tts_engine', 'gemini');
win.renderReadingResult('===第1頁===\n兔子跳過小河了。牠回頭看看大家。', 'zh');
win.setReadMode('companion');
T.stubCallAI(async () => '[{"after":-1,"type":"talk","text":"小老師開場囉。"}]');
await win.generateCompanion();
const tc = [];
win.fetch = async (url, opt) => { tc.push(JSON.parse(opt.body));
  return { ok: true, status: 200, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: pcmB64 }] }] }) }; };
win.playFrom(0);
await sleep(30);
const tReq = tc.find(b => b.input[0].content[0].text === '小老師開場囉。');
const nReq = tc.find(b => b.input[0].content[0].text === '兔子跳過小河了。');
check('小老師用不同音色', tReq.generation_config.speech_config[0].voice === 'Achird' && nReq.generation_config.speech_config[0].voice === 'Sulafat');
check('小老師用老師語氣', tReq.input[0].content[0].annotations[0].style.includes('國小老師'));
win.stopTTS();
win.localStorage.setItem('homie_read_mode', 'plain');

// ── 15. 中途取消 AI 請求 ─────────────────────────────
win.localStorage.setItem('homie_tts_engine', 'browser');
T.setImages(1);
let gotSignal = null;
T.stubCallAI((prompt, images, onChunk, signal) => { gotSignal = signal;
  return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new win.DOMException('aborted', 'AbortError')))); });
const hwRun = win.runHomework();
const hwBtn = win.document.getElementById('hwBtn');
check('分析中按鈕提示可取消', hwBtn.textContent.includes('再按一次取消') && !hwBtn.disabled);
win.runHomework();   // 再按一次 = 取消
await hwRun;
check('取消會中止請求', gotSignal && gotSignal.aborted);
check('取消後顯示「已取消」而不是錯誤', win.document.querySelector('#hwResults .notice-box')?.textContent.includes('已取消') && !win.document.querySelector('#hwResults .error-box'));
check('取消後按鈕恢復', hwBtn.textContent.includes('重新解題'));
T.stubCallAI(async () => '第一行');
await win.runHomework();
check('取消後可以正常再跑一次', !!win.document.querySelector('#hwResults .md-body'));

T.setRdImages(1);
T.stubCallAI((prompt, images, onChunk, signal) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(new win.DOMException('aborted', 'AbortError')))));
const rdRun = win.runReading();
win.runReading();
await rdRun;
check('繪本辨識也能取消', win.document.querySelector('#rdResults .notice-box')?.textContent.includes('已取消'));

// signal 有傳到 fetch
let fetchSignal = null;
win.fetch = async (url, opt) => { fetchSignal = opt.signal;
  return sse('{"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}'); };
win.localStorage.setItem('homie_gemini_key', 'AIza-test');
T.setProvider('gemini');
win.switchProvider('gemini', true);
const ac = new win.AbortController();
await T.callReal('p', [], null, ac.signal);
check('取消訊號有傳給 API 請求', fetchSignal === ac.signal);

// ── 16. 有結果時底部大按鈕不再浮動 ─────────────────────
check('CSS：有結果時 sticky 按鈕回到原位', /\.panel\.has-result \.sticky-action\s*\{[^}]*position:\s*static/.test(win.document.querySelector('style').textContent));
win.renderReadingResult(BOOK, 'zh');
check('繪本有結果時面板標記 has-result', win.document.getElementById('panel-reading').classList.contains('has-result'));
win.resetPanel('rd');
check('新繪本後取消標記', !win.document.getElementById('panel-reading').classList.contains('has-result'));

// ── 17. 解題結果唸給孩子聽 ───────────────────────────
const realParse = win.marked.parse;
win.marked.parse = () => '<h2>需要訂正</h2><ul><li>第3題 → 正確答案是 <mark>8</mark>（不是 9）</li></ul>' +
  '<h2>逐題說明</h2><ol><li><p>第1題 正確 🎉</p></li><li><p>第2題 ___ 填「大」</p></li></ol>';
win.renderReadingResult(BOOK, 'zh');   // 先有一本繪本，等等測兩個播放器切換
win.document.getElementById('hwResults').innerHTML = '';
win.renderHomeworkResult('（內容由 stub 產生）', '', false);
win.marked.parse = realParse;
const hwSegs = win.document.querySelectorAll('#hwResults .hw-seg');
check('解題結果每段都可點', hwSegs.length === 5, String(hwSegs.length));
check('解題播放器出現、沒有陪讀切換', !!win.document.getElementById('hwPlayer') && !win.document.querySelector('#hwPlayer .mode-toggle'));
check('解題播放器提示用「段」', win.document.querySelector('#hwPlayer [data-pl="plStatus"]').textContent.includes('共 5 段'));
check('繪本播放器的 id 不受影響', win.document.getElementById('plPlay').closest('.player').id === 'rdPlayer');
check('解題有結果時面板標記 has-result', win.document.getElementById('panel-homework').classList.contains('has-result'));

spoken.length = 0;
hwSegs[1].click();
check('點解題段落開始唸', spoken[0] === '第3題，正確答案是 8（不是 9）', JSON.stringify(spoken));
check('箭頭改成停頓、標記拿掉', !spoken[0].includes('→'));
win.speechSynthesis.finish();   // → h2 逐題說明
win.speechSynthesis.finish();   // → 第1題
check('表情符號不唸', spoken[spoken.length - 1] === '第1題 正確', JSON.stringify(spoken));
win.speechSynthesis.finish();
check('填空底線不唸', spoken[spoken.length - 1] === '第2題 填「大」', JSON.stringify(spoken));
check('解題段落高亮', hwSegs[4].classList.contains('active'));

// 兩個播放器切換：點繪本的句子 → 解題停下、改唸繪本
const rdSegs = win.document.querySelectorAll('#rdResults .para-segment');
spoken.length = 0;
rdSegs[1].click();
await sleep(150);
check('點繪本句子切換到繪本播放器', spoken[spoken.length - 1] === '他走進森林。' && T.state().len === 4, JSON.stringify(spoken));
check('切換後解題高亮清掉', !win.document.querySelector('#hwResults .hw-seg.active'));
check('繪本狀態列更新', win.document.getElementById('plStatus').textContent.includes('/ 4 句'));
spoken.length = 0;
hwSegs[0].click();
await sleep(150);
check('再點解題段落切回解題', spoken[spoken.length - 1] === '需要訂正' && T.state().len === 5, JSON.stringify(spoken));
win.stopTTS();

// ── 18. 書本排版斷行合併 ─────────────────────────────
let m18 = win.mergeLayoutLines(['小熊肚子好餓，他慢慢地走', '進森林裡找東西吃。', '森林裡好安靜。']);
check('中文排版斷行接回', eq(m18, ['小熊肚子好餓，他慢慢地走進森林裡找東西吃。', '森林裡好安靜。']), JSON.stringify(m18));
m18 = win.mergeLayoutLines(['一閃一閃亮晶晶', '滿天都是小星星']);
check('童謠短行不合併', m18.length === 2, JSON.stringify(m18));
m18 = win.mergeLayoutLines(['「你好嗎？」', '小熊問。']);
check('對話結束的行不合併', m18.length === 2);
m18 = win.mergeLayoutLines(['The little bear walked into the', 'forest to look for some won-', 'derful food.', 'It was quiet.']);
check('英文斷行與連字號接回', eq(m18, ['The little bear walked into the forest to look for some wonderful food.', 'It was quiet.']), JSON.stringify(m18));
m18 = win.mergeLayoutLines(['Twinkle twinkle little star', 'How I wonder what you are']);
check('英文大寫開頭的行不合併', m18.length === 2);
win.localStorage.setItem('homie_tts_engine', 'browser');
win.renderReadingResult('===第1頁===\n小熊肚子好餓，他慢慢地走\n進森林裡找東西吃。森林裡好安靜。', 'zh');
const segs18 = [...win.document.querySelectorAll('#rdResults .para-segment')].map(e => e.textContent);
check('朗讀不再被排版斷行切斷', eq(segs18, ['小熊肚子好餓，他慢慢地走進森林裡找東西吃。', '森林裡好安靜。']), JSON.stringify(segs18));
let ocrPrompt = '';
T.setRdImages(1);
T.stubCallAI(async (prompt) => { ocrPrompt = prompt; return '===第1頁===\n測試。'; });
await win.runReading();
check('辨識指令要求合併排版斷行', ocrPrompt.includes('排版造成的換行'));

// ── 19. 男聲女聲 ─────────────────────────────────────
win.localStorage.setItem('homie_gemini_key', 'AIza-test');
win.localStorage.setItem('homie_tts_engine', 'gemini');
win.renderReadingResult(BOOK, 'zh');
const groups = [...win.document.querySelectorAll('#ttsVoice optgroup')].map(g => g.label);
check('AI 音色分女聲／男聲兩組', eq(groups, ['👩 女聲', '👨 男聲']), JSON.stringify(groups));
check('音色名稱帶性別圖示', win.document.querySelector('#ttsVoice option').textContent.startsWith('👩'));
check('女聲旁白 → 小老師用男聲', win.cloudVoice('gemini', 'teacher') === 'Achird');
win.localStorage.setItem('homie_voice_gemini', 'Puck');
check('男聲旁白 → 小老師用女聲', win.cloudVoice('gemini', 'teacher') === 'Sulafat');
win.localStorage.setItem('homie_voice_openai', 'cedar');
check('OpenAI 男聲旁白 → 小老師用女聲', win.cloudVoice('openai', 'teacher') === 'marin');
win.localStorage.removeItem('homie_voice_gemini');
check('內建語音認得的名字標女聲', win.browserVoiceGender({ name: 'Meijia' }) === 'f' && win.browserVoiceGender({ name: 'Microsoft HsiaoChen Online (Natural)' }) === 'f');
check('內建語音認得的名字標男聲', win.browserVoiceGender({ name: 'Microsoft Zhiwei' }) === 'm' && win.browserVoiceGender({ name: 'Google UK English Male' }) === 'm');
check('Female 不會被誤判成 Male', win.browserVoiceGender({ name: 'Google UK English Female' }) === 'f');
check('認不出的名字不標', win.browserVoiceGender({ name: 'Chinese Taiwan' }) === '');

// 試聽：沒在播放時換聲音，唸一句範例，不預先產生故事句子
const tts19 = [];
win.fetch = async (url, opt) => { tts19.push(JSON.parse(opt.body).input[0].content[0].text);
  return { ok: true, status: 200, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: pcmB64 }] }] }) }; };
win.document.getElementById('ttsVoice').value = 'Charon';
win.onVoiceChange();
await sleep(30);
check('換聲音時試聽一句範例', eq(tts19, ['你好，我們一起來讀故事吧！']), JSON.stringify(tts19));
check('試聽不改變播放狀態', !T.state().isPlaying && T.state().playIdx === -1);
win.localStorage.setItem('homie_tts_engine', 'browser');
win.renderReadingResult(BOOK, 'zh');
spoken.length = 0;
win.onVoiceChange();
check('內建語音也能試聽', spoken[0] === '你好，我們一起來讀故事吧！');
win.stopTTS();
win.localStorage.removeItem('homie_voice_gemini');

// ── 20. A 階段：介面骨架 ─────────────────────────────
const doc = win.document;
check('金鑰設定搬進設定面板', !!doc.querySelector('#settingsSheet #apiKeyInput') && !doc.getElementById('apiBanner'));
check('模型、年級、聲音都在設定面板', ['modelSelect', 'childGrade', 'ttsEngine', 'ttsVoice'].every(id => doc.querySelector('#settingsSheet #' + id)));
check('科目與補充提示留在解題畫面', !!doc.querySelector('#panel-homework .subject-row') && !!doc.querySelector('#panel-homework #hwHint'));
check('繪本不必再選中英文', !doc.querySelector('[data-group="rdLang"]'));
check('分頁改名：檢查作業／聽故事', doc.getElementById('tab-homework').textContent.includes('檢查作業') && doc.getElementById('tab-reading').textContent.includes('聽故事'));
check('CSS：手機版分頁列固定在底部', /\.tabs\s*\{\s*position:\s*fixed;\s*bottom:\s*0/.test(doc.querySelector('style').textContent));
win.openSettings();
check('打開設定面板', doc.getElementById('settingsSheet').classList.contains('show'));
win.closeSettings();
check('關閉設定面板', !doc.getElementById('settingsSheet').classList.contains('show'));

// 金鑰提示卡
win.localStorage.removeItem('homie_gemini_key');
T.setProvider('gemini'); win.switchProvider('gemini', true);
check('沒有金鑰時顯示「去設定」提示', doc.getElementById('setupCard').style.display === 'flex');
doc.getElementById('apiKeyInput').value = 'AIza-new';
win.saveApiKey();
check('存了金鑰提示就消失', doc.getElementById('setupCard').style.display === 'none');

// 播放器精簡：只剩播放控制、語速、陪讀模式
win.localStorage.setItem('homie_tts_engine', 'browser');
win.renderReadingResult(BOOK, 'zh');
const pl = doc.getElementById('rdPlayer');
check('播放器上沒有引擎／聲音選單', !pl.querySelector('#ttsEngine') && !pl.querySelector('#ttsVoice'));
check('語速留在播放器上', !!pl.querySelector('[data-pl="ttsSpeed"]'));
check('陪讀年級改用設定裡的孩子年級', !pl.querySelector('[data-pl="cpGrade"]') && !!pl.querySelector('[data-pl="cpDensity"]'));

// 孩子年級套用到解題與陪讀
doc.getElementById('childGrade').value = 'mid';
doc.getElementById('childGrade').dispatchEvent(new win.Event('change'));
check('年級設定會記住', win.localStorage.getItem('homie_child_grade') === 'mid');
let gp = '';
T.setImages(1);
T.stubCallAI(async (prompt) => { gp = prompt; return '答案'; });
await win.runHomework();
check('解題 prompt 帶孩子年級', gp.includes('國小中年級學生'));
win.setReadMode('companion');
T.stubCallAI(async (prompt) => { gp = prompt; return '[]'; });
await win.generateCompanion();
check('陪讀 prompt 帶孩子年級', gp.includes('國小中年級'));
win.setReadMode('plain');

// 繪本語言自動判斷
check('中文繪本判斷為中文', win.detectLang('===第1頁===\n小熊肚子好餓。') === 'zh');
check('英文繪本判斷為英文（頁碼標記的中文不算）', win.detectLang('===第1頁===\nThe bear was hungry. He walked into the woods.') === 'en');
check('中文夾少量英文仍算中文', win.detectLang('小熊說：「Hello！」然後走進森林裡找蜂蜜吃。') === 'zh');
T.setRdImages(1);
T.stubCallAI(async () => '===第1頁===\nThe bear was hungry.');
spoken.length = 0;
await win.runReading();
win.playFrom(0);
check('英文繪本自動用英文語音', T.utter().lang === 'en-US');
win.stopTTS();

// 從相簿分享：service worker 暫存 → 頁面讀出 → 問要做什麼
const shareStore = new Map([[new URL('shared/0', win.location.href).href, new win.Blob(['x'], { type: 'image/jpeg' })]]);
win.caches = {
  open: async () => ({ match: async (u) => shareStore.has(u) ? { blob: async () => shareStore.get(u) } : undefined }),
  delete: async () => { shareStore.clear(); return true; }
};
win.history.replaceState(null, '', '/homie/index.html?shared=1');
await win.receiveShared();
check('收到分享的照片會問要做什麼', doc.getElementById('shareSheet').classList.contains('show') && doc.getElementById('shareCount').textContent.includes('1 張'));
check('讀完就清掉網址參數與暫存', !win.location.search && shareStore.size === 0);
win.clearImages('rd');
T.stubCompress(async (f) => ({ mime: f.type, dataUrl: 'data:,shared' }));
win.useShared('rd');
await sleep(20);
check('選「聽故事」就切到繪本並加入照片', doc.getElementById('panel-reading').classList.contains('active') && T.rdImages().length === 1);

// ── 21. B 階段：結果卡片、引導提示、錯題本、練習、複查 ─────
const HW_REPLY = '## 逐題說明\n1. 第1題：正確，答案是 8。\n\n2. 第2題：正確答案是 <mark>12</mark>（不是 13）。\n\n3. 第3題：這題還沒寫，先看上面的提示自己想想看。\n\n' +
  '```json\n{"subject":"數學","items":[' +
  '{"no":"第1題","question":"5+3=?","status":"correct","child":"8","answer":"8","why":"","concept":"十以內的加法","hints":[]},' +
  '{"no":"第2題","question":"7+5=?","status":"wrong","child":"13","answer":"12","why":"進位時多加了 1","concept":"二十以內的進位加法","hints":["先把 7 湊成 10"]},' +
  '{"no":"第3題","question":"9+6=?","status":"blank","child":"","answer":"15","why":"9 先湊 10","concept":"二十以內的進位加法","hints":["9 再加幾就是 10？","10 再加剩下的 5 是多少？"]}' +
  ']}\n```';
check('串流時不顯示 JSON', !win.stripJsonTail(HW_REPLY).includes('"items"'));
const split = win.splitHomework(HW_REPLY);
check('解析出結構化資料', split.data && split.data.items.length === 3 && split.data.subject === '數學');
check('說明部分不含 JSON', !split.md.includes('```json'));
check('壞掉的 JSON 退回純說明', win.splitHomework('說明\n```json\n{壞掉').data === null);

win.localStorage.setItem('homie_tts_engine', 'browser');
T.setImages(1);
T.stubCallAI(async () => HW_REPLY);
await win.runHomework();
await sleep(50);
const hwBox = doc.getElementById('hwResults');
check('摘要：幾題要訂正、幾題沒寫', hwBox.querySelector('.hw-summary').textContent === '1 題要訂正、1 題還沒寫', hwBox.querySelector('.hw-summary').textContent);
const cards = hwBox.querySelectorAll(':scope > .mk-card');
check('只列出要處理的題目（答對的不列）', cards.length === 2);
check('寫錯的題目直接看到正確答案', cards[0].querySelector('.mk-ans')?.textContent === '12' && cards[0].textContent.includes('你寫：13'));
check('沒寫的題目先不給答案', !cards[1].querySelector('.mk-ans') && !cards[1].textContent.includes('15'));
const hintBtn = [...cards[1].querySelectorAll('.mk-btn')].find(b => b.textContent.includes('提示'));
hintBtn.click();
check('按一次給第一個提示', cards[1].querySelectorAll('.mk-hint').length === 1 && hintBtn.textContent.includes('再給一個提示'));
spoken.length = 0;
cards[1].querySelector('.mk-say').click();
check('🔊 只唸題目和已出現的提示，不唸答案', spoken[0].includes('9+6=?') && spoken[0].includes('9 再加幾就是 10') && !spoken[0].includes('15'), spoken[0]);
hintBtn.click();
check('第二個提示後按鈕變成看答案', cards[1].querySelectorAll('.mk-hint').length === 2 && hintBtn.textContent.includes('看答案'));
hintBtn.click();
check('最後才看到答案', cards[1].querySelector('.mk-ans')?.textContent === '15');
check('完整說明收在「看全部說明」', !!hwBox.querySelector('details.hw-full .md-body') && !hwBox.querySelector('details.hw-full').open);
check('朗讀播放器在完整說明裡', !!hwBox.querySelector('details.hw-full #hwPlayer'));
check('有複查按鈕', [...hwBox.querySelectorAll('button')].some(b => b.textContent.includes('拍照複查')));

// 錯題本
let mk = await win.mkAll();
check('寫錯和沒寫的題目自動收進錯題本', mk.length === 2 && mk.every(r => r.state === 'open' && r.subject === '數學'));
await win.refreshMkBadge();
check('錯題本分頁顯示待練習數量', doc.getElementById('mkBadge').textContent === '2' && doc.getElementById('mkBadge').style.display !== 'none');
const hist = JSON.parse(win.localStorage.getItem('homie_hw_history'))[0];
check('歷史預覽不含 JSON', !hist.preview.includes('items'));
win.restoreHistory('hw', hist);
await sleep(30);
check('重看歷史不會重複收錄', (await win.mkAll()).length === 2);

win.switchTab('mistakes');
await sleep(50);
check('錯題本列出 2 題', doc.querySelectorAll('#mkList .mk-card').length === 2);
check('錯題本統計與最常錯觀念', doc.getElementById('mkStats').textContent.includes('待練習 2 題') && doc.getElementById('mkStats').textContent.includes('二十以內的進位加法（2）'));
check('錯題本裡的題目要先自己想（答案藏起來）', !doc.querySelector('#mkList .mk-ans'));
const masterBtn = [...doc.querySelectorAll('#mkList .mk-btn')].find(b => b.textContent.includes('學會了'));
masterBtn.click();
await sleep(50);
check('按「學會了」移到已學會', doc.querySelectorAll('#mkList .mk-card').length === 1 && (await win.mkAll()).filter(r => r.state === 'mastered').length === 1);
doc.querySelector('#mkState [data-state="mastered"]').click();
await sleep(50);
check('已學會分頁看得到', doc.querySelectorAll('#mkList .mk-card').length === 1);
doc.querySelector('#mkState [data-state="open"]').click();
await sleep(50);

// 再練 3 題
let pp = '';
T.stubCallAI(async (prompt) => { pp = prompt; return '[{"question":"8+5=?","answer":"13","hint":"8 先湊 10"},{"question":"6+7=?","answer":"13","hint":"7 先湊 10"},{"question":"9+4=?","answer":"13","hint":"9 先湊 10"}]'; });
const rec = (await win.mkAll()).find(r => r.state === 'open');
await win.openPractice(rec);
await sleep(30);
check('練習題依觀念與年級出題', pp.includes(rec.concept) && pp.includes('國小中年級') && pp.includes(rec.question));
check('練習面板出現 3 題', doc.getElementById('practiceSheet').classList.contains('show') && doc.querySelectorAll('#practiceBody .mk-card').length === 3);
check('練習題答案先藏起來', !doc.querySelector('#practiceBody .mk-ans'));
check('錯題本記一次練習', (await win.mkAll()).find(r => r.id === rec.id).practiced === 1);
win.closePractice();

// 訂正複查
win.switchTab('homework');
win.restoreHistory('hw', hist);
win.startReview();
check('進入複查模式', doc.getElementById('hwReviewBar').style.display === 'flex' && doc.getElementById('hwReviewList').textContent === '第2題、第3題');
check('複查按鈕文字', doc.getElementById('hwBtn').textContent.includes('開始複查'));
T.setImages(1);
let rp = '';
T.stubCallAI(async (prompt) => { rp = prompt; return '[{"no":"第2題","fixed":true,"child":"12","comment":"改對了，很棒！"},{"no":"第3題","fixed":false,"child":"14","comment":"再數一次 10 加 5"}]'; });
await win.runHomework();
await sleep(50);
check('複查只送上次錯的題目', rp.includes('第2題：7+5=?') && rp.includes('第3題：9+6=?') && !rp.includes('5+3=?'));
check('複查結果摘要', hwBox.querySelector('.review-result .hw-summary').textContent.includes('1 題改對了') );
check('還沒改對的題目附提示', hwBox.querySelector('.review-row.bad .mk-hint')?.textContent.includes('9 再加幾'));
mk = await win.mkAll();
check('錯題本記下訂正結果', mk.find(r => r.no === '第2題').corrected === true && mk.find(r => r.no === '第3題').corrected === false);
check('複查完離開複查模式', doc.getElementById('hwReviewBar').style.display === 'none' && doc.getElementById('hwBtn').textContent.includes('重新解題'));

// 匯出／匯入
let dl = null;
const realClick = win.HTMLAnchorElement.prototype.click;
win.HTMLAnchorElement.prototype.click = function () { dl = { name: this.download, href: this.href }; };
await win.exportMistakes();
win.HTMLAnchorElement.prototype.click = realClick;
const exported = JSON.parse(await blobs[dl.href].text());
check('匯出備份檔', dl.name.startsWith('homie-錯題本-') && exported.mistakes.length === 2 && exported.version === T.version());
win.alert = (m) => { win.__alert = m; };
const imp = { files: [new win.File([JSON.stringify({ mistakes: [{ id: 'x-1', no: '第9題', question: '1+1=?', answer: '2', status: 'wrong', hints: [], state: 'open', ts: Date.now() }] })], 'b.json')], value: 'b.json' };
await win.importMistakes(imp);
check('匯入備份會合併', (await win.mkAll()).length === 3 && win.__alert.includes('匯入 1 題'));

// ── 23. C 階段：照片編輯、縮圖、花費、分享、查單字 ─────
const nr = win.normRect({ x: 300, y: 50 }, { x: 100, y: 500 }, 400, 400);
check('裁切範圍：兩點拉出長方形並夾在圖片內', nr.x === 100 && nr.y === 50 && nr.w === 200 && nr.h === 350, JSON.stringify(nr));
win.clearImages('hw');
T.stubCompress(async () => ({ mime: 'image/jpeg', dataUrl: 'data:,a' }));
await win.addImages([{ name: 'a' }], 'hw');
check('預覽縮圖有「調整」按鈕', !!doc.querySelector('#hwPreview .edit-btn'));

// 花費：Gemini 用量
win.localStorage.removeItem('homie_usage');
win.localStorage.setItem('homie_gemini_key', 'AIza-test');
T.setProvider('gemini'); win.switchProvider('gemini', true);
win.fetch = async () => sse('{"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":2000,"candidatesTokenCount":500,"thoughtsTokenCount":500}}');
await T.callReal('p', [], null);
const gCost = (2000 * 0.75 + 1000 * 3.75) / 1e6;
check('Gemini：依用量（含思考 token）算花費', Math.abs(T.lastCost() - gCost) < 1e-12, String(T.lastCost()));
let usage = JSON.parse(win.localStorage.getItem('homie_usage'));
const mk1 = Object.keys(usage)[0];
check('記入本月花費與次數', usage[mk1].calls === 1 && Math.abs(usage[mk1].usd - gCost) < 1e-12);
// Claude 用量
win.localStorage.setItem('homie_claude_key', 'sk-ant-test');
T.setProvider('claude'); win.switchProvider('claude', true);
win.fetch = async () => sseMulti([
  { type: 'message_start', message: { usage: { input_tokens: 1000, output_tokens: 1 } } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 400 } }
]);
await T.callReal('p', [], null);
check('Claude：讀 message_start／message_delta 的用量', Math.abs(T.lastCost() - (1000 * 1 + 400 * 5) / 1e6) < 1e-12, String(T.lastCost()));
// OpenAI 用量
win.localStorage.setItem('homie_openai_key', 'sk-test');
T.setProvider('openai'); win.switchProvider('openai', true);
let oaBody = null;
win.fetch = async (url, opt) => { oaBody = JSON.parse(opt.body); return sseMulti([
  { choices: [{ delta: { content: 'OK' } }] },
  { choices: [], usage: { prompt_tokens: 3000, completion_tokens: 600 } }
]); };
await T.callReal('p', [], null);
check('OpenAI：要求串流附上用量', oaBody.stream_options && oaBody.stream_options.include_usage === true);
check('OpenAI：依用量算花費', Math.abs(T.lastCost() - (3000 * 1 + 600 * 6) / 1e6) < 1e-12, String(T.lastCost()));
usage = JSON.parse(win.localStorage.getItem('homie_usage'));
check('本月累計 3 次', usage[mk1].calls === 3);
win.renderUsage();
check('設定裡顯示本月花費', doc.getElementById('usageText').textContent.includes('本月約 NT$') && doc.getElementById('usageText').textContent.includes('3 次'));
check('台幣顯示格式', win.fmtTwd(0.0016) === 'NT$0.05' && win.fmtTwd(0.2) === 'NT$6.4' && win.fmtTwd(1) === 'NT$32');
T.setProvider('gemini'); win.switchProvider('gemini', true);

// 解題結果顯示這次花費、分享按鈕
win.localStorage.setItem('homie_tts_engine', 'browser');
T.setImages(1);
T.stubCallAI(async () => HW_REPLY);
await win.runHomework();
await sleep(30);
check('解題結果有分享按鈕', [...doc.querySelectorAll('#hwResults .mk-btn')].some(b => b.textContent.includes('分享結果')));
const sl = win.shareLines(win.splitHomework(HW_REPLY).data, new Date(2026, 9, 12).getTime());
check('分享圖片內容：日期科目、摘要、每題答案', sl[0].t === '2026/10/12・數學' && sl[1].t.includes('1 題要訂正') &&
  sl.some(l => l.t === '孩子寫：13 → 正確：12') && sl.some(l => l.t === '答案：15') && !sl.some(l => l.t.includes('5+3')));
const fakeCtx = { measureText: (t) => ({ width: [...t].length * 10 }) };
const wl = win.wrapText(fakeCtx, '這是一段很長很長的中文說明文字', 60);
check('分享圖片中文折行', wl.length === 3 && wl.every(l => [...l].length <= 6), JSON.stringify(wl));
const we = win.wrapText(fakeCtx, 'The bear walked home', 110);
check('分享圖片英文不拆單字', we.every(l => !/^[a-z]/.test(l) || l.split(' ').every(w => 'The bear walked home'.includes(w))), JSON.stringify(we));

// 歷史縮圖與上限 30
await win.dbTx('thumbs', 'readwrite', st => { st.put({ ts: 111, thumb: 'data:image/jpeg;base64,THUMB', pages: 1 }); });
win.localStorage.setItem('homie_rd_history', JSON.stringify([{ ts: 111, subject: '繪本', preview: '小熊', full: '===第1頁===\n小熊。', readLang: 'zh' }]));
win.loadHistoryUI('rd');
await sleep(30);
check('歷史紀錄顯示縮圖', doc.querySelector('#rdHistoryList .h-thumb')?.getAttribute('src') === 'data:image/jpeg;base64,THUMB');
const many = Array.from({ length: 30 }, (_, i) => ({ ts: 1029 - i, subject: '數學', preview: 'x', full: 'x' }));
win.localStorage.setItem('homie_hw_history', JSON.stringify(many));
await win.dbTx('thumbs', 'readwrite', st => { st.put({ ts: 1000, thumb: 'data:,old' }); });
win.saveHistory('hw', '新的一筆', null, '');
await sleep(30);
const hh = JSON.parse(win.localStorage.getItem('homie_hw_history'));
check('超過 30 筆時擠掉最舊的', hh.length === 30 && !hh.some(x => x.ts === 1000));
check('被擠掉的紀錄縮圖一起刪', !(await win.getThumb(1000)));

// 英文繪本查單字
check('取出點到的單字', win.wordAt('The bear was brave.', 14) === 'brave' && win.wordAt('The bear was brave.', 18) === 'brave');
check('撇號單字保留、標點去掉', win.wordAt('"Don\'t go!" he said.', 3) === "Don't");
check('點到空白或標點不算', win.wordAt('Hi , you', 3) === '');
win.renderReadingResult('===Page 1===\nThe bear was brave.', 'en');
check('英文繪本才有查單字按鈕', !!doc.querySelector('#rdPlayer [data-pl="wordBtn"]'));
win.toggleWordMode();
check('打開查單字模式', T.wordMode() && doc.getElementById('rdResults').classList.contains('word-mode'));
let wq = 0;
T.stubCallAI(async (prompt) => { wq++; return '{"zh":"勇敢的","pos":"形容詞","note":"小熊很勇敢，不害怕"}'; });
spoken.length = 0;
await win.lookupWord('brave', 'The bear was brave.');
check('單字面板顯示中文意思與詞性', doc.getElementById('wordSheet').classList.contains('show') && doc.querySelector('#wordBody .word-zh').textContent === '勇敢的' && doc.getElementById('wordBody').textContent.includes('形容詞'));
check('查單字會唸出單字（英文語音）', spoken.includes('brave') && T.utter().lang === 'en-US');
win.closeWord();
await win.lookupWord('Brave', 'Another sentence.');
check('同一個字第二次查用快取', wq === 1);
win.toggleWordMode();
win.renderReadingResult(BOOK, 'zh');
check('中文繪本沒有查單字按鈕', !doc.querySelector('#rdPlayer [data-pl="wordBtn"]'));

// ── 24. 模型選擇記住、字體大小、跟讀 ─────────────────
win.localStorage.setItem('homie_gemini_key', 'AIza-test');
win.localStorage.setItem('homie_claude_key', 'sk-ant-test');
T.setProvider('gemini'); win.switchProvider('gemini', true);
const ms = doc.getElementById('modelSelect');
ms.value = 'gemini-3.7-flash';
win.onModelChange();
T.setProvider('claude'); win.switchProvider('claude', true);
ms.value = 'claude-opus-5-5';
win.onModelChange();
T.setProvider('gemini'); win.switchProvider('gemini', true);
check('切回 Gemini 仍是選過的 3.7 Flash', ms.value === 'gemini-3.7-flash', ms.value);
T.setProvider('claude'); win.switchProvider('claude', true);
check('切回 Claude 仍是選過的 Opus 5.5', ms.value === 'claude-opus-5-5', ms.value);
check('費用標示跟著換', doc.getElementById('costBadge').textContent === '~$0.008 / 次');
win.localStorage.setItem('homie_model_claude', 'claude-old-removed');
win.switchProvider('claude', true);
check('記住的模型已下架就用預設', ms.value === 'claude-haiku-4-5');
win.localStorage.removeItem('homie_model_claude');
win.localStorage.removeItem('homie_model_gemini');
T.setProvider('gemini'); win.switchProvider('gemini', true);

win.setFontScale('xlarge');
check('字體特大：倍率 1.4', doc.documentElement.style.getPropertyValue('--fs') === '1.4' && win.localStorage.getItem('homie_font_scale') === 'xlarge');
check('字體按鈕標示目前選項', doc.querySelector('#fontScale [data-fs="xlarge"]').classList.contains('on'));
check('CSS：閱讀文字跟著倍率放大', /\.result-content \{ font-size: calc\(15px \* var\(--fs\)\)/.test(doc.querySelector('style').textContent));
win.setFontScale('bogus');
check('不認得的值退回標準', doc.documentElement.style.getPropertyValue('--fs') === '1');
win.setFontScale('normal');

// 比對評分
let cmp = win.compareSpeech('小熊肚子好餓。', '小熊肚子好餓', 'zh');
check('中文全部唸對 = 100%', cmp.score === 1 && cmp.marks.filter(m => m.ok === null).length === 1);
cmp = win.compareSpeech('小熊肚子好餓。', '小熊好餓', 'zh');
check('漏字會被標出來', Math.abs(cmp.score - 4 / 6) < 1e-9 && cmp.marks.filter(m => m.ok === false).map(m => m.t).join('') === '肚子');
check('數字與國字視為相同', win.compareSpeech('他有三顆蘋果', '他有3顆蘋果', 'zh').score === 1);
cmp = win.compareSpeech('The bear was very hungry.', 'the bear was hungry', 'en');
check('英文依單字比對、不分大小寫', cmp.score === 0.8 && cmp.marks.find(m => m.t === 'very').ok === false);
check('星星門檻', win.shadowStars(0.9) === 3 && win.shadowStars(0.7) === 2 && win.shadowStars(0.3) === 1);

// 跟讀流程（模擬語音辨識）
let recs = [];
win.SpeechRecognition = class { constructor() { recs.push(this); this.started = false; } start() { this.started = true; } abort() { this.aborted = true; } };
const srEvent = (alts) => ({ results: [Object.assign(alts.map(t => ({ transcript: t })), { isFinal: true })] });
win.localStorage.setItem('homie_tts_engine', 'browser');
win.renderReadingResult(BOOK, 'zh');
win.localStorage.removeItem('homie_shadow_seen');
win.setReadMode('shadow');
check('跟讀模式提示麥克風與隱私', doc.getElementById('plNotice').textContent.includes('Google') && doc.querySelector('#rdPlayer [data-mode="shadow"]').classList.contains('on'));
spoken.length = 0;
win.playFrom(0);
check('先由 AI 唸第一句', spoken[0] === '小熊說：「我好餓。」' && recs.length === 0);
win.speechSynthesis.finish();
check('AI 唸完就開始聽孩子唸', recs.length === 1 && recs[0].started && recs[0].lang === 'zh-TW' && T.shadow() === 'listening');
check('狀態列提示換你唸', doc.getElementById('plStatus').textContent.includes('換你唸'));
recs[0].onresult(srEvent(['小熊說我好', '小熊說我好餓']));
const fb = doc.querySelector('#rdResults .shadow-fb');
check('評分：取最接近原文的候選結果', !!fb && fb.textContent.includes('⭐⭐⭐') && fb.textContent.includes('聽到：小熊說我好餓'), fb && fb.textContent);
check('評分卡片放在那一句後面', fb.previousElementSibling === doc.querySelectorAll('#rdResults .para-segment')[0]);
check('評分後收起第一次的說明', doc.getElementById('plNotice').style.display === 'none');
win.setReadMode('plain'); win.setReadMode('shadow');
check('第二次進入跟讀不再顯示長說明', doc.getElementById('plNotice').style.display === 'none');
win.playFrom(0); win.speechSynthesis.finish(); recs[recs.length - 1].onresult(srEvent(['小熊說我好餓']));
check('三顆星後停下等待、位置指向下一句', T.shadow() === 'done' && T.state().playIdx === 1 && !T.state().isPlaying);
await sleep(1600);
check('三顆星自動接下一句', spoken[spoken.length - 1] === '他走進森林。', JSON.stringify(spoken));
win.speechSynthesis.finish();
recs[recs.length - 1].onresult(srEvent(['他走']));
const fb2 = doc.querySelector('#rdResults .shadow-fb');
check('唸不完整只有一顆星、標出漏掉的字', fb2.textContent.includes('⭐　再試一次') && fb2.querySelectorAll('.sf-miss').length === 3);
check('一次只顯示一張評分卡', doc.querySelectorAll('#rdResults .shadow-fb').length === 1);
const nRecs = recs.length;
[...fb2.querySelectorAll('.mk-btn')].find(b => b.textContent.includes('再唸一次')).click();
check('再唸一次：直接再聽，不重唸原文', recs.length === nRecs + 1 && T.shadow() === 'listening');
recs[recs.length - 1].onerror({ error: 'no-speech' });
check('沒聽到聲音時提示再試', doc.querySelector('#rdResults .shadow-fb').textContent.includes('沒有聽到聲音'));
win.playFrom(2);
check('播放時會停掉辨識', recs[recs.length - 1].aborted === true || T.shadow() === null);
win.stopTTS();
win.setReadMode('plain');
check('切回純朗讀清掉評分卡', !doc.querySelector('#rdResults .shadow-fb'));
delete win.SpeechRecognition;
win.setReadMode('shadow');
check('不支援語音辨識的瀏覽器會提示', doc.getElementById('plNotice').textContent.includes('不支援語音辨識'));
win.setReadMode('plain');

// ── 22. 版本號一致 ───────────────────────────────────
const ver = T.version();
const swSrc = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const clSrc = fs.readFileSync(new URL('./CHANGELOG.md', import.meta.url), 'utf8');
check('設定裡顯示版本號', doc.getElementById('appVersion').textContent === ver);
check('版本號與 sw.js 快取版本一致', swSrc.includes(`'homie-${ver}'`), ver);
check('版本號與 CHANGELOG 最新一版一致', (clSrc.match(/^## (v\d+\.\d+\.\d+)/m) || [])[1] === ver, (clSrc.match(/^## (v\d+\.\d+\.\d+)/m) || [])[1]);

console.log(results.join('\n'));
const pass = results.filter(r => r.startsWith('PASS')).length;
console.log('\n' + pass + '/' + results.length + ' 通過');
if (pass !== results.length) process.exit(1);
