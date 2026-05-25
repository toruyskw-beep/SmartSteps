/* =====================================================================
 * 生成AI版 診断文エンジン  (script-ai.js)
 * ---------------------------------------------------------------------
 * Google Gemini API（gemini-2.5-flash-lite）を使って診断文を生成する。
 * APIキーは config.json から読み込む。
 *
 *   入力: { subjectKey, grade, term, sogo, kanten:{観点:A/B/C}, units:[{name,meate,grade}] }
 *   出力: Promise<{ red, green:[], blue }>
 *
 * Gemini API エンドポイント:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
 *
 * config.json:
 *   { "gemini_api_key": "YOUR_KEY", "gemini_model": "gemini-2.5-flash-lite" }
 * ===================================================================== */


/* =====================================================================
 * 1. config.json の読み込み
 * ===================================================================== */

let _geminiConfig = null;   // { gemini_api_key, gemini_model }

async function loadGeminiConfig(){
  if(_geminiConfig) return _geminiConfig;
  const res = await fetch("config.json");
  if(!res.ok) throw new Error("config.json の読み込みに失敗しました。");
  _geminiConfig = await res.json();
  if(!_geminiConfig.gemini_api_key || _geminiConfig.gemini_api_key === "YOUR_API_KEY_HERE"){
    throw new Error("config.json の gemini_api_key を設定してください。\nGoogle AI Studio (https://aistudio.google.com) でAPIキーを取得できます。");
  }
  return _geminiConfig;
}


/* =====================================================================
 * 2. Gemini API 呼び出し
 * ===================================================================== */

async function callGeminiAPI(systemPrompt, userPrompt){
  const config = await loadGeminiConfig();
  const model  = config.gemini_model || "gemini-2.5-flash-lite";
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini_api_key}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      { role: "user", parts: [{ text: userPrompt }] }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if(!res.ok){
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || res.statusText;
    throw new Error(`Gemini API エラー (${res.status}): ${msg}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if(!text) throw new Error("Gemini API から応答テキストを取得できませんでした。");
  return text.trim();
}


/* =====================================================================
 * 3. プロンプト構築
 *    入力データを整理してGeminiに渡す文章を作る
 * ===================================================================== */

const SYSTEM_PROMPT = `あなたは小学校の担任教師のアシスタントです。
通知表の「学習のようす」欄に書く個人所見文を生成します。

【生成ルール】
- 対象は保護者が読む文章です。平易でわかりやすい言葉を使ってください。
- 肯定的・前向きな表現を基本にしてください。
- 評価Aはよくできていることを具体的に褒める表現で。
- 評価Bはだいたいできているが引き続き頑張るよう励ます表現で。
- 評価Cは苦手な点に触れつつ、改善・努力を促す前向きな表現で。
- 1つの所見文は30〜60字程度にまとめてください。
- 体言止めは使わず、「〜できています。」「〜しましょう。」など文末を整えてください。
- 出力はJSON形式で返してください。マークダウンのコードブロックは使わずJSONのみ返してください。`;

function buildUserPrompt(input){
  const subjectLabel = window.SUBJECTS?.[input.subjectKey]?.label || input.subjectKey;
  const isYear = input.term === "年間";
  const termLabel = isYear ? `${input.grade}年・年間` : `${input.grade}年・${input.term}`;
  const gradeMap = {A:"よくできている", B:"だいたいできている", C:"もう少し"};

  // 観点評価
  const kantenLines = Object.entries(input.kanten)
    .filter(([,v]) => v)
    .map(([k, v]) => `  - ${k}：${gradeMap[v]}（${v}）`)
    .join("\n");

  // 単元評価（算理社英）
  const unitLines = input.units
    .filter(u => u.grade)
    .map(u => `  - ${u.name}（めあて：${u.meate}）：${gradeMap[u.grade]}（${u.grade}）`)
    .join("\n");

  const prompt = `
【対象児童の評価データ】
教科：${subjectLabel}
学年・学期：${termLabel}
総合評価：${input.sogo ? gradeMap[input.sogo]+"（"+input.sogo+"）" : "未入力"}

【観点別評価】
${kantenLines || "（未入力）"}

${input.subjectKey !== "kokugo" ? `【単元別評価】\n${unitLines || "（未入力）"}` : ""}

【出力形式】
以下のJSON形式で返してください：
{
  "red": "総評の文（総合評価に基づく30〜50字）",
  "green": [
    {"ord": "①観点", "label": "観点名", "text": "その観点の所見文"},
    ...
    {"ord": "単元", "label": "単元名", "text": "その単元の所見文"}
  ]
}
`.trim();

  return prompt;
}


/* =====================================================================
 * 4. APIレスポンスのパース
 *    GeminiのJSON出力を {red, green[], blue} に変換する
 * ===================================================================== */

function parseGeminiResponse(text, input){
  // JSONを抽出（コードブロックが含まれる場合も対応）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if(!jsonMatch) throw new Error("AIの応答からJSONを取得できませんでした。\n応答内容：" + text.slice(0, 200));

  let parsed;
  try{
    parsed = JSON.parse(jsonMatch[0]);
  }catch(e){
    throw new Error("AIの応答のJSONパースに失敗しました：" + e.message);
  }

  // red
  const red = parsed.red || "（総評の生成に失敗しました）";

  // green：APIが返した行をそのまま使う（足りない場合はフォールバック）
  const green = Array.isArray(parsed.green) ? parsed.green : [];

  return {
    red,
    green,
    blue: "1問ごとの○×入力が必要なため、本システムでは対象外です。",
    _meta: { mode:"gemini", model: _geminiConfig?.gemini_model }
  };
}


/* =====================================================================
 * 5. 公開API
 *    テンプレート版 generateDiagnosis() と同じシグネチャ
 * ===================================================================== */

async function generateDiagnosisAI(input){
  const systemPrompt = SYSTEM_PROMPT;
  const userPrompt   = buildUserPrompt(input);

  try{
    const text   = await callGeminiAPI(systemPrompt, userPrompt);
    return parseGeminiResponse(text, input);
  }catch(e){
    // エラーを診断文形式で返す（画面にエラー内容を表示）
    return {
      red:   `⚠️ AI生成エラー：${e.message}`,
      green: [],
      blue:  "1問ごとの○×入力が必要なため、本システムでは対象外です。",
      _meta: { mode:"gemini", error: e.message }
    };
  }
}
