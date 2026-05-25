/* =====================================================================
 * RAG版 診断文エンジン  (script-rag.js)
 * ---------------------------------------------------------------------
 * テンプレート版 (script.js) と同じ入力・同じ出力形式を持つ。
 *
 *   入力: { subjectKey, grade, term, sogo, kanten:{観点:A/B/C}, units:[{name,meate,grade}] }
 *   出力: Promise<{ red, green:[], blue, _refs:[] }>  ※非同期（API呼び出し想定）
 *         _refs: 参照した診断文マスタの根拠一覧（RAG特有の出力）
 *
 * RAGの考え方:
 *   診断文マスタJSON（data/*.json）を「知識ベース（ベクトルDB相当）」として扱い、
 *   入力条件に最も近い文面を検索・取得したうえでAIに渡し、
 *   それを参考にしながら児童に合わせた自然な文章を生成させる。
 *
 * 現バージョン: モック実装
 *   ① 診断文マスタJSONから該当する文を「実際に引く」（本物のRAG検索相当）
 *   ② 引いた文を「参照根拠（refs）」として記録
 *   ③ マスタの文をベースに若干の表現を加えてRAG生成らしい出力を返す
 *   本番実装時は ③ を Anthropic API 呼び出しに置き換える。
 *
 * 本番実装時の想定プロンプト構造:
 *   system: 小学校の通知表の学習所見を書くアシスタント
 *   context（RAG検索結果）: 類似する観点・学年の既存診断文サンプル複数件
 *   user:   学年・教科・学期・観点評価・単元評価＋「上記サンプルを参考に書いて」
 * ===================================================================== */


/* =====================================================================
 * 1. 診断文マスタからの検索（RAG検索相当）
 * ===================================================================== */

// 観点別診断文を「実際に」マスタから引く（=本物のRAG検索のキー検索相当）
// KANTEN_DB は script.js が window に公開しているものを参照
function ragFetchKanten(subjectKey, grade, kanten, evalGrade){
  const db = window.KANTEN_DB;
  if(!db || !db[subjectKey]) return null;
  const g = db[subjectKey].grades[String(grade)];
  const k = g && g[kanten];
  if(!k || !k[evalGrade]) return null;
  return {
    source: `${subjectKey}.json`,
    key:    `${grade}年 / ${kanten} / ${evalGrade}`,
    text:   k[evalGrade]
  };
}

// 隣接学年の同観点同評価の文も取得（RAGらしく複数文を参照する演出）
function ragFetchKantenNeighbor(subjectKey, grade, kanten, evalGrade){
  const db = window.KANTEN_DB;
  if(!db || !db[subjectKey]) return null;
  const neighborGrade = String(Math.min(6, Math.max(1, parseInt(grade) + 1)));
  const g = db[subjectKey].grades[neighborGrade];
  const k = g && g[kanten];
  if(!k || !k[evalGrade]) return null;
  return {
    source: `${subjectKey}.json`,
    key:    `${neighborGrade}年（隣接学年） / ${kanten} / ${evalGrade}`,
    text:   k[evalGrade]
  };
}


/* =====================================================================
 * 2. RAG生成ロジック（マスタ文を元に表現を加える・モック）
 * ===================================================================== */

// マスタから引いた文をベースに「RAGらしく少し調整した文」を作る（モック）
// 本番では Anthropic API にマスタ文を context として渡して生成させる
function ragAdaptText(baseText, evalGrade){
  if(!baseText) return "（参照できる文面がありません）";
  // モックでは文末に学期的な一言を添えるだけで「参考にしつつAIが書いた」雰囲気を出す
  const suffix = {
    A: "",
    B: "引き続き意欲的に取り組むことを期待しています。",
    C: "今後の一層の努力に期待しています。"
  }[evalGrade] || "";
  // 文末の句点を調整して付け足す
  const base = baseText.replace(/[。．]$/, "");
  return suffix ? `${base}。${suffix}` : baseText;
}

// 総評（赤枠）
function buildRedRAG(input){
  if(!input.sogo) return "（総合評価を選択してください）";
  // 総評はマスタに文がないためAI版と同様に生成（RAGは主に観点・単元文で使う）
  const subjectLabel = window.SUBJECTS?.[input.subjectKey]?.label || "この教科";
  const termLabel = isYearRAG(input.term) ? `${input.grade}年間` : `${input.term}`;
  if(input.sogo === "A"){
    return `${termLabel}の${subjectLabel}の学習では，各単元の内容をしっかりと理解し，優れた成果を示すことができました。`;
  }else if(input.sogo === "B"){
    return `${termLabel}の${subjectLabel}の学習では，各単元の内容をおおむね理解し，着実に力をのばすことができました。`;
  }else{
    return `${termLabel}の${subjectLabel}の学習では，基礎的な内容の定着に向けて，さらなる努力が期待されます。`;
  }
}

// 緑枠の組み立て（参照根拠を _refs に記録）
function buildGreenRAG(input, refs){
  const lines = [];
  const second = (input.term === "2学期" || input.term === "3学期" || input.term === "後期");

  // 前学期比較
  if(!isYearRAG(input.term) && second){
    lines.push({ord:"①前学期比較", text:"前学期の取り組みを踏まえ，着実に成長しています。", note:"（RAG生成）"});
  }

  // 観点別：マスタから実際に文を引いて参照根拠に記録
  const kEntries = Object.entries(input.kanten).filter(([,v]) => v);
  const kantenOrd = (!isYearRAG(input.term) && second) ? "②観点" : "①観点";
  kEntries.forEach(([k, v]) => {
    const ref     = ragFetchKanten(input.subjectKey, input.grade, k, v);
    const refNext = ragFetchKantenNeighbor(input.subjectKey, input.grade, k, v);
    if(ref)     refs.push(ref);
    if(refNext) refs.push(refNext);
    const baseText = ref ? ref.text : `（${k} ${v} の診断文 未登録）`;
    lines.push({ord:kantenOrd, label:k, text:ragAdaptText(baseText, v)});
  });

  // 単元別：めあてマスタは検索済みの unit オブジェクトを直接使う
  if(input.subjectKey !== "kokugo"){
    input.units.forEach(u => {
      if(!u.grade) return;
      const meateRef = {source:"meate_*.json", key:`${u.name} / ${u.grade}`, text:u.meate};
      refs.push(meateRef);
      // RAGでは「めあて」を根拠にAIが自然文を生成するイメージ
      const suffix = {A:"についてよく理解することができました。", B:"についておおむね理解できています。", C:"について，基礎から丁寧に復習していきましょう。"}[u.grade];
      lines.push({ord:"単元", label:u.name || "", text:(u.meate || "") + suffix});
    });
  }
  return lines;
}

function isYearRAG(term){ return term === "年間"; }

// 公開API：テンプレート版と同じシグネチャ（Promiseを返す）
// モックは setTimeout で API遅延を模擬（800〜1600ms・AIより少し重い）
function generateDiagnosisRAG(input){
  return new Promise(resolve => {
    const delay = 800 + Math.random() * 800;
    const refs = [];
    setTimeout(() => {
      resolve({
        red:   buildRedRAG(input),
        green: buildGreenRAG(input, refs),
        blue:  "1問ごとの○×入力が必要なため、本システムでは対象外です。",
        _refs: refs,
        _meta: { mode:"rag-mock", note:"診断文マスタJSONを参照根拠としたRAGモック出力" }
      });
    }, delay);
  });
}
