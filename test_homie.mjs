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
  setRetry: (ms) => { TTS_RETRY_MS = ms; }
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

console.log(results.join('\n'));
const pass = results.filter(r => r.startsWith('PASS')).length;
console.log('\n' + pass + '/' + results.length + ' 通過');
if (pass !== results.length) process.exit(1);
