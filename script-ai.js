/* =====================================================================
 * 生成AI版 診断文エンジン  (script-ai.js)
 * ---------------------------------------------------------------------
 * テンプレート版 (script.js) と同じ入力・同じ出力形式を持つ。
 *
 *   入力: { subjectKey, grade, term, sogo, kanten:{観点:A/B/C}, units:[{name,meate,grade}] }
 *   出力: Promise<{ red, green:[], blue }>  ※非同期（API呼び出し想定）
 *
 * 現バージョン: モック実装
 *   実際の Anthropic API 呼び出しは行わず、入力を元に
 *   「AIが生成しそうな自然文」を擬似的に生成して返す。
 *   API接続時はこのファイルの generateDiagnosisAI() 内を
 *   fetch('/api/diagnosis', ...) 等のサーバー呼び出しに置き換える。
 *
 * 本番実装時の想定プロンプト構造:
 *   system: 小学校の通知表の学習所見を書くアシスタント
 *   user:   学年・教科・学期・観点評価・単元評価を構造化して渡す
 *   制約:   50〜80字程度・肯定的表現・保護者向けの平易な言葉
 * ===================================================================== */


/* =====================================================================
 * 1. 擬似生成ロジック（モック）
 * ===================================================================== */

// 評価ABCに応じた形容詞（AI文体で使う語彙）
const AI_ADJ = {
  A: ["大変よく", "意欲的に", "着実に", "しっかりと"],
  B: ["おおむね", "だいたい", "ほぼ問題なく", "少しずつ"],
  C: ["これから", "引き続き", "さらに", "もう少し"]
};

// 評価ABCに応じた締めくくり（AI文体）
const AI_CLOSE = {
  A: "今後のさらなる成長が期待されます。",
  B: "引き続き取り組んでいきましょう。",
  C: "一歩ずつ丁夫に取り組んでいきましょう。"
};

// ランダムに語彙を選ぶ（モックの多様性演出）
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

// 総評（赤枠）の生成
function buildRedAI(input){
  if(!input.sogo) return "（総合評価を選択してください）";
  const subjectLabel = window.SUBJECTS?.[input.subjectKey]?.label || "この教科";
  const termLabel = isYearAI(input.term) ? `${input.grade}年間` : `${input.term}`;
  const adj = pick(AI_ADJ[input.sogo]);
  const close = AI_CLOSE[input.sogo];
  if(input.sogo === "A"){
    return `${termLabel}を通じて，${subjectLabel}の学習に${adj}取り組み，大きな成果を上げることができました。${close}`;
  }else if(input.sogo === "B"){
    return `${termLabel}を通じて，${subjectLabel}の学習に${adj}取り組むことができました。${close}`;
  }else{
    return `${termLabel}の${subjectLabel}の学習では，${adj}力をつけていきたいところです。${close}`;
  }
}

// 観点別の文（緑枠の観点部分）
function buildKantenAI(subjectKey, grade, kanten, evalGrade){
  const adj = pick(AI_ADJ[evalGrade]);
  if(evalGrade === "A"){
    return `「${kanten}」については，${adj}理解を深め，自信をもって取り組むことができています。`;
  }else if(evalGrade === "B"){
    return `「${kanten}」については，${adj}身についてきています。`;
  }else{
    return `「${kanten}」については，${adj}学び直す機会をつくっていきましょう。`;
  }
}

// 単元別の文（緑枠の単元部分）
function buildUnitAI(unit){
  const adj = pick(AI_ADJ[unit.grade]);
  if(unit.grade === "A"){
    return `${unit.meate}について，${adj}理解することができました。`;
  }else if(unit.grade === "B"){
    return `${unit.meate}については，${adj}取り組めています。`;
  }else{
    return `${unit.meate}については，${adj}復習に取り組んでいきましょう。`;
  }
}

// 緑枠の組み立て
function buildGreenAI(input){
  const lines = [];
  const second = (input.term === "2学期" || input.term === "3学期" || input.term === "後期");

  // 前学期比較（AI文体）
  if(!isYearAI(input.term) && second){
    lines.push({ord:"①前学期比較", text:"前学期に引き続き，着実に力をのばしています。", note:"（AI生成）"});
  }

  // 観点別診断文
  const kEntries = Object.entries(input.kanten).filter(([,v]) => v);
  const kantenOrd = (!isYearAI(input.term) && second) ? "②観点" : "①観点";
  kEntries.forEach(([k, v]) => {
    lines.push({ord:kantenOrd, label:k, text:buildKantenAI(input.subjectKey, input.grade, k, v)});
  });

  // 単元別
  if(input.subjectKey !== "kokugo"){
    input.units.forEach(u => {
      if(!u.grade) return;
      lines.push({ord:"単元", label:u.name || "", text:buildUnitAI(u)});
    });
  }
  return lines;
}

function isYearAI(term){ return term === "年間"; }

// 公開API：テンプレート版と同じシグネチャ（Promiseを返す）
// モックは setTimeout で API遅延を模擬（500〜1200ms）
function generateDiagnosisAI(input){
  return new Promise(resolve => {
    const delay = 500 + Math.random() * 700;
    setTimeout(() => {
      resolve({
        red:   buildRedAI(input),
        green: buildGreenAI(input),
        blue:  "1問ごとの○×入力が必要なため、本システムでは対象外です。",
        _meta: { mode:"ai-mock", note:"Anthropic API 接続前のモック出力" }
      });
    }, delay);
  });
}
