/* =====================================================================
 * 個人分析診断文 生成ロジック  (script.js)
 * ---------------------------------------------------------------------
 * 仕様書「個人分析診断文_仕様書.md」に基づくサンプル実装。
 *
 * 構成:
 *   1. マスタデータ            … 観点・準拠・単元・診断文テンプレート
 *   2. 診断文生成エンジン       … 入力(評価)から診断文を組み立てる純粋ロジック
 *   3. 画面制御(UI)            … フォーム描画・入力収集・プレビュー表示
 *
 * ※ サンプルのため、診断文マスタ・単元リストは抜粋。
 *    実運用では Excel の各シートを DB/JSON 化して読み込む想定。
 * ===================================================================== */


/* =====================================================================
 * 1. マスタデータ
 * ===================================================================== */

// 教科ごとの観点（仕様書 6.1）
const KANTEN = {
  "国語":   ["知識・技能","漢字","言葉","思・判・表","話す・聞く","書く","読む","主学態"],
  "算数":   ["知識・技能","思・判・表","主学態"],
  "理科":   ["知識・技能","思・判・表","主学態"],
  "社会":   ["知識・技能","思・判・表","主学態"],
  "外国語": ["知識・技能","思・判・表","主学態"]
};

// 教科ごとの対象学年（仕様書 6.1 / 7.1）
const GRADE_RANGE = {
  "国語":[1,2,3,4,5,6], "算数":[1,2,3,4,5,6],
  "理科":[3,4,5,6], "社会":[3,4,5,6], "外国語":[5,6]
};

// 教科ごとの準拠（使用教科書）（仕様書 7.1）
const JUNKYO = {
  "国語":   [],
  "算数":   ["東書","啓林","大日","学図","教出","日文"],
  "理科":   ["東書","啓林","大日","学図","教出","信教"],
  "社会":   ["東書","教出","日文","（地域版）"],
  "外国語": ["東書","光村","教出","開隆","三省"]
};

// 単元マスタ（めあてシート相当・抜粋）
// 実際は 学年×学期×準拠×No. で単元/めあてが一意に決まる
const UNITS = {
  "算数": [
    {name:"整数と小数",            meate:"整数と小数のしくみ"},
    {name:"体積",                  meate:"直方体や立方体の体積の求め方"},
    {name:"比例",                  meate:"比例の意味や比例関係の表し方"},
    {name:"小数のかけ算",          meate:"小数をかける計算"},
    {name:"単位量あたりの大きさ",  meate:"単位量あたりの大きさと速さ"}
  ],
  "理科": [
    {name:"植物の発芽",  meate:"植物が発芽する条件"},
    {name:"天気の変化",  meate:"雲と天気の関係"}
  ],
  "社会": [
    {name:"日本の国土",  meate:"日本の地形や気候の特色"},
    {name:"米づくり",    meate:"米づくりのさかんな地域"}
  ],
  "外国語": [
    {name:"Unit1 Hello",     meate:"名前や好きなものを伝え合おう"},
    {name:"Unit2 Birthday",  meate:"誕生日やほしいものを伝え合おう"}
  ]
};

// 観点別診断文マスタ（観点別診断文シート相当・抜粋）
const KANTEN_BUN = {
  "知識・技能":{A:"数量や図形などの性質がよくわかり，計算もよくできています。", B:"数量や図形などの性質がだいたいわかっています。", C:"数量や図形などの性質を，もう一度おさらいしましょう。"},
  "思・判・表":{A:"筋道を立てて考え，問題を解決する力が身についています。",     B:"筋道を立てて考える力が，だいたい身についています。",   C:"筋道を立てて考える練習を重ねましょう。"},
  "主学態":  {A:"見通しをもって進んで学習に取り組んでいます。",               B:"進んで学習に取り組もうとしています。",                 C:"進んで学習に取り組むようにしましょう。"},
  "漢字":    {A:"学習した漢字がほとんど書けています。",                       B:"学習した漢字がだいたい書けています。",                 C:"学習した漢字を書けるようにおさらいしましょう。"},
  "言葉":    {A:"言葉についての理解が十分できています。",                     B:"言葉の理解がだいたいできています。",                   C:"言葉の使い方に注意しましょう。"},
  "話す・聞く":{A:"大事なことを落とさず話したり聞いたりできています。",       B:"だいたい話したり聞いたりできています。",               C:"よく聞いて話すようにしましょう。"},
  "書く":    {A:"わかりやすい文章を書く力が身についています。",               B:"文章を書く力がだいたい身についています。",             C:"ふだんから簡単な文章を書きましょう。"},
  "読む":    {A:"内容を正しく読み取ることができています。",                   B:"内容をだいたい読み取れています。",                     C:"ていねいに読むよう心がけましょう。"}
};

// 総評テンプレート（仕様書 4.3）
const SOGO_TERM = {A:"○学期の学習がよくできています。", B:"○学期の学習がだいたいできています。", C:"○学期の学習がもう少しです。"};
const SOGO_YEAR = {A:"○年の学習がよくできています。",   B:"○年の学習がほぼできています。",       C:"○年の学習を復習しましょう。"};

// 単元別「学習のようす」テンプレート（算理社英・仕様書 4.4）
const UNIT_LEARN = {A:"については，よくできています。", B:"については，だいたいできています。", C:"について，よく復習しましょう。"};

// 「最も到達度の低い単元」テンプレート（仕様書 5.1）
const WORST_UNIT = {
  full:"が，とてもよくわかっています。",   // 到達度100%
  A:"を，もう一度見直しましょう。",
  B:"を，よく復習しましょう。",
  C:"を，基礎に戻って確認しましょう。"
};

// 前学期比較テンプレート（仕様書 5.2）
function compareTermBun(prev, cur){
  if(!prev || !cur) return null;
  if(prev===cur){
    return {A:"高い学力で安定しています。", B:"学習が定着しています。", C:"学習の定着に問題があるのでよく復習しましょう。"}[cur];
  }
  const rank={A:1,B:2,C:3};
  return rank[prev] > rank[cur]   // 数字が小さいほど良い → prevのほうが悪ければ向上
    ? "努力のあとがみられます。"
    : "学習の定着が不完全なので復習しましょう。";
}

// 学期制ごとの学期ラベル（仕様書 2.2）
const TERMS = {
  "3term":   ["1学期","2学期","3学期","年間"],
  "2term":   ["1学期","2学期","年間"],
  "2termHK": ["前期","後期","年間"]
};


/* =====================================================================
 * 2. 診断文生成エンジン（純粋ロジック・UIに依存しない）
 * ---------------------------------------------------------------------
 *  input = {
 *    subject, grade, termType, term,   // 基本設定
 *    sogo,                             // 総合評価 'A'|'B'|'C'
 *    kanten: { 観点名: 'A'|'B'|'C', ... },
 *    units:  [ {grade:'A'|'B'|'C', reach:number|''} , ... ]  // 単元別
 *  }
 *  return = { red:string, green:string[], blue:string }
 * ===================================================================== */

const RANK = {A:1, B:2, C:3};

function isKokugo(subject){ return subject === "国語"; }
function isYear(term){ return term === "年間"; }

// 赤枠：総評
function buildRed(input){
  if(!input.sogo) return "（総合評価を選択してください）";
  if(isYear(input.term)){
    return SOGO_YEAR[input.sogo].replace("○年", input.grade + "年");
  }
  return SOGO_TERM[input.sogo].replace("○学期", input.term);
}

// 観点文（1観点ぶん）
function kantenSentence(kanten, grade){
  const t = KANTEN_BUN[kanten];
  return (t && t[grade]) || `（${kanten}の${grade}の診断文）`;
}

// 観点ごとに最も到達度の低い単元の文を作る（算理社英）
// サンプルでは単元を1グループとして「最低評価＝同点なら先頭」を採用（仕様書 5.1）
function worstUnitSentence(input){
  const valid = input.units
    .map((u, idx) => ({...u, idx}))
    .filter(u => u.grade);
  if(valid.length === 0) return null;

  // 到達度100%の単元があれば優先的にfull文（簡略仕様）
  const full = valid.find(u => String(u.reach) === "100");
  if(full){
    return UNITS[input.subject][full.idx].meate + WORST_UNIT.full;
  }
  // 最も評価の低い単元（C>B>A）、同点は先頭（=最初に見つかったもの）
  let worst = null;
  valid.forEach(u => {
    if(!worst || RANK[u.grade] > RANK[worst.grade]) worst = u;
  });
  return UNITS[input.subject][worst.idx].meate + WORST_UNIT[worst.grade];
}

// 緑枠：学習のようす（学期/教科で構成が変化）
function buildGreen(input){
  const lines = [];
  const second = (input.term === "2学期" || input.term === "3学期" || input.term === "後期");

  // ① 2,3学期(後期)のみ：前学期比較文を先頭に
  //    ※サンプルでは前学期評価を持たないため固定文で代用
  if(!isYear(input.term) && second){
    lines.push({ord:"①前学期比較", text:"学習が定着しています。", note:"（前学期のABCと比較して自動判定）"});
  }

  // ② 観点別診断文（各観点）
  const kEntries = Object.entries(input.kanten).filter(([,v]) => v);
  const kantenOrd = (!isYear(input.term) && second) ? "②観点" : "①観点";
  kEntries.forEach(([k, v]) => {
    lines.push({ord:kantenOrd, label:k, text:kantenSentence(k, v)});
  });

  // ③ 最も到達度の低い単元（算理社英のみ。年間の国語は対象外＝そもそも国語は単元なし）
  if(!isKokugo(input.subject)){
    const w = worstUnitSentence(input);
    if(w) lines.push({ord:"最低到達単元", text:w});
  }

  return lines;
}

// 公開API：診断文一式を生成
function generateDiagnosis(input){
  return {
    red:   buildRed(input),
    green: buildGreen(input),
    blue:  "1問ごとの○×入力が必要なため、本システムでは対象外です。"
  };
}


/* =====================================================================
 * 3. 画面制御（UI）
 * ===================================================================== */

const $ = sel => document.querySelector(sel);

// 現在の入力状態
const state = {
  sogo: null,
  kanten: {},     // 観点名 -> 'A'|'B'|'C'
  units: []       // [{grade, reach}]
};

// ----- セレクト要素 -----
const els = {
  name:     $("#studentName"),
  grade:    $("#grade"),
  termType: $("#termType"),
  subject:  $("#subject"),
  term:     $("#term"),
  junkyo:   $("#junkyo"),
  junkyoField: $("#junkyoField"),
  unitCard: $("#unitCard")
};

// 入力状態をエンジン用inputに変換
function collectInput(){
  return {
    subject:  els.subject.value,
    grade:    els.grade.value,
    termType: els.termType.value,
    term:     els.term.value,
    sogo:     state.sogo,
    kanten:   state.kanten,
    units:    state.units
  };
}

// 学期セレクトを学期制に合わせて再構築
function rebuildTerms(){
  const list = TERMS[els.termType.value];
  const prev = els.term.value;
  els.term.innerHTML = list.map(t => `<option value="${t}">${t}</option>`).join("");
  if(list.includes(prev)) els.term.value = prev;
}

// 教科変更に伴うフォーム全体の再構築
function rebuildForm(){
  const subject = els.subject.value;

  // 準拠（国語は教科書選択なし）
  if(isKokugo(subject)){
    els.junkyoField.style.display = "none";
  }else{
    els.junkyoField.style.display = "";
    els.junkyo.innerHTML = JUNKYO[subject].map((j,i) =>
      `<option ${i===0?"selected":""}>${j}</option>`).join("");
  }

  // 観点ノート
  $("#kantenNote").innerHTML = isKokugo(subject)
    ? "<b>国語</b>は単元別の診断文を持たず、<b>観点別診断文のみ</b>で「学習のようす（緑枠）」を構成します（観点8つ）。"
    : "「学習のようす（緑枠）」は<b>観点別診断文＋単元別評価</b>から組み立てます。";

  // 観点行を再構築
  state.kanten = {};
  $("#kantenRows").innerHTML = KANTEN[subject].map(k => `
    <tr>
      <td class="kanten-name">${k}</td>
      <td>
        <div class="abc" data-kanten="${k}">
          <button type="button" data-g="A">A</button>
          <button type="button" data-g="B">B</button>
          <button type="button" data-g="C">C</button>
        </div>
      </td>
    </tr>`).join("");

  // 単元カード（国語は非表示）
  if(isKokugo(subject)){
    els.unitCard.style.display = "none";
    state.units = [];
  }else{
    els.unitCard.style.display = "";
    const list = UNITS[subject] || [];
    state.units = list.map(() => ({grade:null, reach:""}));
    $("#unitNote").innerHTML = "評価Aは「めあて＋についてはよくできています」等、<b>めあてと評価を組み合わせて</b>診断文を生成。観点ごとに<b>最も到達度の低い単元</b>も診断文に使われます。";
    $("#unitRows").innerHTML = list.map((u,i) => `
      <tr>
        <td>
          <div class="kanten-name">${u.name}</div>
          <div class="unit-meate">${u.meate}</div>
        </td>
        <td>
          <div class="abc" data-unit="${i}">
            <button type="button" data-g="A">A</button>
            <button type="button" data-g="B">B</button>
            <button type="button" data-g="C">C</button>
          </div>
        </td>
        <td class="reach"><input type="text" data-reach="${i}" placeholder="—"></td>
      </tr>`).join("");
  }

  bindAbcButtons();
  render();
}

// ABCボタン・到達度入力のイベント結線
function bindAbcButtons(){
  document.querySelectorAll(".abc").forEach(group => {
    group.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        group.querySelectorAll("button").forEach(b => b.classList.remove("on"));
        btn.classList.add("on");
        const g = btn.dataset.g;
        if(group.id === "sogoAbc")                 state.sogo = g;
        else if(group.dataset.kanten !== undefined) state.kanten[group.dataset.kanten] = g;
        else if(group.dataset.unit   !== undefined) state.units[+group.dataset.unit].grade = g;
        render();
      });
    });
  });
  document.querySelectorAll("[data-reach]").forEach(inp => {
    inp.addEventListener("input", () => {
      state.units[+inp.dataset.reach].reach = inp.value;
      render();
    });
  });
}

// プレビュー描画
function render(){
  const input = collectInput();
  const result = generateDiagnosis(input);
  const body = $("#pvBody");
  body.innerHTML = "";

  // 赤枠
  body.insertAdjacentHTML("beforeend",
    `<div class="frame red"><span class="ftag">総評（赤枠）</span><p>${result.red}</p></div>`);

  // 緑枠
  let green;
  if(result.green.length === 0){
    green = `<p style="color:#888">観点・単元の評価を入力すると診断文が表示されます。</p>`;
  }else{
    const lines = result.green.map(l => {
      const label = l.label ? `<b>${l.label}</b>：` : "";
      const note  = l.note  ? `<span class="ord-note">${l.note}</span>` : "";
      return `<div class="line"><span class="ord">${l.ord}</span>${label}${l.text}${note}</div>`;
    }).join("");
    green = `<div class="multi">${lines}</div>`;
  }
  body.insertAdjacentHTML("beforeend",
    `<div class="frame green"><span class="ftag">学習のようす（緑枠）</span>${green}</div>`);

  // 青枠
  body.insertAdjacentHTML("beforeend",
    `<div class="frame blue"><span class="ftag">アドバイス（青枠）</span><p>${result.blue}</p></div>`);

  // フッター
  const subject = input.subject === "外国語" ? "外国語（英語）" : input.subject;
  $("#pvFoot").textContent =
    `${input.grade}年・${subject}・${isYear(input.term) ? "年間" : input.term}` +
    (isKokugo(input.subject) ? "｜国語：観点別のみ" : `｜準拠：${els.junkyo.value}`) +
    (isYear(input.term) ? "｜年間は最大4要素を連結" : "");
}

// ----- イベント登録 -----
els.subject.addEventListener("change", rebuildForm);
els.termType.addEventListener("change", () => { rebuildTerms(); render(); });
els.grade.addEventListener("change", render);
els.term.addEventListener("change", render);
els.junkyo.addEventListener("change", render);
$("#confirmBtn").addEventListener("click", () => {
  const r = generateDiagnosis(collectInput());
  alert("診断文を登録しました（サンプル）。\n\n【総評】\n" + r.red +
        "\n\n【学習のようす】\n" + r.green.map(l => (l.label?l.label+"：":"") + l.text).join("\n"));
});

// ----- 初期化 -----
rebuildTerms();
rebuildForm();