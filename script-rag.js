/* =====================================================================
 * RAG版 診断文エンジン  (script-rag.js)
 * ---------------------------------------------------------------------
 * 実装の流れ:
 *   1. 事前埋め込みJSON (embeddings_kanten.json / embeddings_meate.json) を読み込む
 *   2. 入力データからクエリ文を組み立てる
 *   3. Gemini Embedding API (gemini-embedding-001) でクエリをベクトル化
 *   4. コサイン類似度で上位K件を検索 (kanten・meate それぞれ)
 *   5. 検索結果をコンテキストとして Gemini generateContent API に渡す
 *   6. 生成された診断文 + 参照根拠 (_refs) を返す
 *
 *   入力: { subjectKey, grade, term, sogo, kanten:{観点:A/B/C}, units:[{name,meate,grade}] }
 *   出力: Promise<{ red, green:[], blue, _refs:[] }>
 *
 * 前提:
 *   embed_all.py を実行して data/embeddings_*.json が生成済みであること。
 *   config.json に gemini_api_key が設定済みであること。
 * ===================================================================== */


/* =====================================================================
 * 1. 埋め込みデータベースの読み込み・保持
 * ===================================================================== */

const RAG_DB = {
  kanten: [],   // embeddings_kanten.json の中身
  meate:  []    // embeddings_meate.json の中身
};
let _ragLoaded = false;

async function loadRagDB(){
  if(_ragLoaded) return;
  const [kantenRes, meateRes] = await Promise.all([
    fetch("data/embeddings_kanten.json"),
    fetch("data/embeddings_meate.json")
  ]);
  if(!kantenRes.ok) throw new Error(`embeddings_kanten.json の読み込みに失敗 (${kantenRes.status})\nembed_all.py を実行してください。`);
  if(!meateRes.ok)  throw new Error(`embeddings_meate.json の読み込みに失敗 (${meateRes.status})\nembed_all.py を実行してください。`);
  RAG_DB.kanten = await kantenRes.json();
  RAG_DB.meate  = await meateRes.json();
  _ragLoaded = true;
  console.log(`RAG DB 読み込み完了: 観点${RAG_DB.kanten.length}件 めあて${RAG_DB.meate.length}件`);
}


/* =====================================================================
 * 2. Gemini Embedding API でクエリをベクトル化
 * ===================================================================== */

async function embedQuery(text){
  const config = await loadGeminiConfig();   // script-ai.js で定義済み
  const model  = config.gemini_model || "gemini-2.5-flash-lite";
  // Embedding は専用モデルを使う
  const embModel = "gemini-embedding-001";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${embModel}:embedContent?key=${config.gemini_api_key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      model: `models/${embModel}`,
      content: {parts: [{text}]},
      taskType: "RETRIEVAL_QUERY",          // クエリは QUERY タイプ
      outputDimensionality: 768             // embed_all.py と合わせる
    })
  });
  if(!res.ok){
    const err = await res.json().catch(() => ({}));
    throw new Error(`Embedding APIエラー (${res.status}): ${err?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return data.embedding.values;
}


/* =====================================================================
 * 3. コサイン類似度検索
 * ===================================================================== */

function cosineSimilarity(a, b){
  let dot = 0, na = 0, nb = 0;
  for(let i = 0; i < a.length; i++){
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 指定DBからクエリに最も近い上位 topK 件を返す
function searchSimilar(queryVector, records, topK = 3){
  return records
    .filter(r => r.vector && r.vector.length > 0)
    .map(r => ({...r, score: cosineSimilarity(queryVector, r.vector)}))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}


/* =====================================================================
 * 4. クエリ文の組み立て
 *    入力評価データを1つのテキストに変換してベクトル化する
 * ===================================================================== */

function buildQueryText(input){
  const subjectLabel = window.SUBJECTS?.[input.subjectKey]?.label || input.subjectKey;
  const gradeMap = {A:"よくできている", B:"だいたいできている", C:"もう少し"};

  // 観点評価をまとめた文
  const kantenText = Object.entries(input.kanten)
    .filter(([,v]) => v)
    .map(([k, v]) => `${k}${gradeMap[v]}`)
    .join("、");

  // 評価済み単元のめあてをまとめた文
  const unitText = input.units
    .filter(u => u.grade)
    .map(u => u.meate)
    .filter(Boolean)
    .join("。");

  return [
    `${subjectLabel} ${input.grade}年 ${input.term}`,
    kantenText,
    unitText
  ].filter(Boolean).join("。");
}


/* =====================================================================
 * 5. RAGプロンプト構築
 * ===================================================================== */

const RAG_SYSTEM_PROMPT = `あなたは小学校の担任教師のアシスタントです。
通知表の「学習のようす」欄に書く個人所見文を生成します。

【生成ルール】
- 対象は保護者が読む文章です。平易でわかりやすい言葉を使ってください。
- 肯定的・前向きな表現を基本にしてください。
- 評価Aはよくできていることを具体的に褒める表現で。
- 評価Bはだいたいできているが引き続き頑張るよう励ます表現で。
- 評価Cは苦手な点に触れつつ、改善・努力を促す前向きな表現で。
- 1つの所見文は30〜60字程度にまとめてください。
- 体言止めは使わず、「〜できています。」「〜しましょう。」など文末を整えてください。
- 必ず参考文の文体・語彙・トーンを活かして生成してください。
- 出力はJSON形式で返してください。マークダウンのコードブロックは使わずJSONのみ返してください。`;

function buildRAGUserPrompt(input, kantenRefs, meateRefs){
  const subjectLabel = window.SUBJECTS?.[input.subjectKey]?.label || input.subjectKey;
  const isYear = input.term === "年間";
  const termLabel = isYear ? `${input.grade}年・年間` : `${input.grade}年・${input.term}`;
  const gradeMap = {A:"よくできている(A)", B:"だいたいできている(B)", C:"もう少し(C)"};

  // RAG参照文を番号付きで列挙
  const kantenContext = kantenRefs.length
    ? kantenRefs.map((r,i) =>
        `[観点参考${i+1}] ${r.subject}${r.grade}年・${r.kanten}・${r.eval} (類似度:${r.score.toFixed(3)})\n  「${r.text}」`
      ).join("\n")
    : "（参考文なし）";

  const meateContext = meateRefs.length
    ? meateRefs.map((r,i) =>
        `[単元参考${i+1}] ${r.name} (類似度:${r.score.toFixed(3)})\n  「${r.text}」`
      ).join("\n")
    : "（参考文なし）";

  // 観点評価
  const kantenLines = Object.entries(input.kanten)
    .filter(([,v]) => v)
    .map(([k, v]) => `  - ${k}：${gradeMap[v]}`)
    .join("\n");

  // 単元評価
  const unitLines = input.units
    .filter(u => u.grade)
    .map(u => `  - ${u.name}（めあて：${u.meate}）：${gradeMap[u.grade]}`)
    .join("\n");

  return `
【検索で取得した参考文（RAGコンテキスト）】
--- 観点別診断文の参考 ---
${kantenContext}

--- めあての参考 ---
${meateContext}

【生成対象の児童データ】
教科：${subjectLabel}
学年・学期：${termLabel}
総合評価：${input.sogo ? gradeMap[input.sogo] : "未入力"}

【観点別評価】
${kantenLines || "（未入力）"}

${input.subjectKey !== "kokugo" ? `【単元別評価】\n${unitLines || "（未入力）"}` : ""}

【出力形式（JSONのみ返してください）】
{
  "red": "総評の文（総合評価に基づく30〜50字）",
  "green": [
    {"ord": "①観点", "label": "観点名", "text": "その観点の所見文（参考文の文体を活かす）"},
    ...
    {"ord": "単元", "label": "単元名", "text": "その単元の所見文（参考文の文体を活かす）"}
  ]
}
`.trim();
}


/* =====================================================================
 * 6. レスポンスのパース（script-ai.js と共通）
 * ===================================================================== */

function parseRagResponse(text){
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if(!jsonMatch) throw new Error("AIの応答からJSONを取得できませんでした。\n応答内容：" + text.slice(0, 200));
  let parsed;
  try{ parsed = JSON.parse(jsonMatch[0]); }
  catch(e){ throw new Error("AIの応答のJSONパースに失敗しました：" + e.message); }
  return {
    red:   parsed.red || "（総評の生成に失敗しました）",
    green: Array.isArray(parsed.green) ? parsed.green : []
  };
}


/* =====================================================================
 * 7. 公開API
 * ===================================================================== */

async function generateDiagnosisRAG(input){
  const refs = { kanten: [], meate: [] };

  try{
    // 埋め込みDBが未読み込みなら読み込む
    await loadRagDB();

    // クエリをベクトル化
    const queryText   = buildQueryText(input);
    const queryVector = await embedQuery(queryText);

    // 観点別診断文から上位3件を検索
    // 教科・学年でフィルタしてから検索（より精度が高い）
    const kantenFiltered = RAG_DB.kanten.filter(r =>
      r.subject === (window.SUBJECTS?.[input.subjectKey]?.label || input.subjectKey)
    );
    const kantenRefs = searchSimilar(queryVector, kantenFiltered.length > 0 ? kantenFiltered : RAG_DB.kanten, 4);

    // めあてから上位3件を検索（算理社英のみ）
    let meateRefs = [];
    if(input.subjectKey !== "kokugo"){
      const subjectLabel = window.SUBJECTS?.[input.subjectKey]?.label || "";
      const meateFiltered = RAG_DB.meate.filter(r => r.subject === subjectLabel);
      meateRefs = searchSimilar(queryVector, meateFiltered.length > 0 ? meateFiltered : RAG_DB.meate, 3);
    }

    refs.kanten = kantenRefs;
    refs.meate  = meateRefs;

    // RAGプロンプトでGemini generateContent を呼ぶ
    const userPrompt = buildRAGUserPrompt(input, kantenRefs, meateRefs);
    const rawText    = await callGeminiAPI(RAG_SYSTEM_PROMPT, userPrompt);  // script-ai.js で定義
    const parsed     = parseRagResponse(rawText);

    // 参照根拠を _refs 形式に変換（画面表示用）
    const allRefs = [
      ...kantenRefs.map(r => ({
        source: `embeddings_kanten.json`,
        key:    `${r.subject}${r.grade}年 / ${r.kanten} / ${r.eval} (類似度:${r.score.toFixed(3)})`,
        text:   r.text
      })),
      ...meateRefs.map(r => ({
        source: `embeddings_meate.json`,
        key:    `${r.name} (類似度:${r.score.toFixed(3)})`,
        text:   r.text
      }))
    ];

    return {
      red:          parsed.red,
      green:        parsed.green,
      blue:         "1問ごとの○×入力が必要なため、本システムでは対象外です。",
      _query:       queryText,       // ① 送ったクエリテキスト
      _refs:        allRefs,         // ② マッチした診断文マスタ
      _prompts:     { system: RAG_SYSTEM_PROMPT, user: userPrompt }, // ③ AIに渡したプロンプト
      _rawResponse: rawText,         // ④ AIの生応答
      _meta:        { mode: "rag-gemini", model: "gemini-embedding-001 + generateContent" }
    };

  }catch(e){
    // 埋め込みDBが未生成の場合はわかりやすいメッセージ
    const isNotReady = e.message.includes("embed_all.py");
    return {
      red:          isNotReady
        ? "⚠️ RAG未初期化：embed_all.py を実行して埋め込みDBを生成してください。"
        : `⚠️ RAG生成エラー：${e.message}`,
      green:        [],
      blue:         "1問ごとの○×入力が必要なため、本システムでは対象外です。",
      _query:       null,
      _refs:        [],
      _prompts:     null,
      _rawResponse: null,
      _meta:        { mode:"rag-gemini", error: e.message }
    };
  }
}
