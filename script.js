/* =====================================================================
 * 個人分析診断文 生成ロジック  (script.js)
 * ---------------------------------------------------------------------
 * 仕様書「個人分析診断文_仕様書.md」に基づくサンプル実装。
 *
 * 観点別診断文の文面は教科別 JSON（data/*.json）から読み込む。
 * このファイルには「文面データ」を一切持たず、ロジックに専念する。
 *
 * 構成:
 *   1. 設定・テンプレート       … 文面以外の固定ルール（総評・接尾語など）
 *   2. 診断文マスタ読み込み     … data/*.json を fetch して保持
 *   3. 診断文生成エンジン       … 入力(評価)から診断文を組み立てる純粋ロジック
 *   4. 画面制御(UI)            … フォーム描画・入力収集・プレビュー表示
 * ===================================================================== */


/* =====================================================================
 * 1. 設定・テンプレート（文面マスタ以外の固定ルール）
 * ===================================================================== */

// 教科キー(JSONファイル名) と 表示名の対応
// 準拠(教科書)・単元・めあては data/meate_*.json から動的に取得する
const SUBJECTS = {
  "kokugo":    {label:"国語"},
  "sansu":     {label:"算数"},
  "rika":      {label:"理科"},
  "shakai":    {label:"社会"},
  "gaikokugo": {label:"外国語（英語）"}
};

// 国語以外は「めあてマスタ(JSON)」を持つ教科キー
const MEATE_SUBJECTS = ["sansu","rika","shakai","gaikokugo"];

// 総評テンプレート（仕様書 4.3）
const SOGO_TERM = {A:"○学期の学習がよくできています。", B:"○学期の学習がだいたいできています。", C:"○学期の学習がもう少しです。"};
const SOGO_YEAR = {A:"○年の学習がよくできています。",   B:"○年の学習がほぼできています。",       C:"○年の学習を復習しましょう。"};

// 単元別「学習のようす」テンプレート（算理社英・仕様書 4.4）
// 各単元の評価ABCに応じて「めあて」に接尾語を付けて出力する
const UNIT_LEARN = {
  A:"については，よくできています。",
  B:"については，だいたいできています。",
  C:"について，よく復習しましょう。"
};

// 「最も到達度の低い単元」テンプレート（仕様書 5.1：観点別診断文で使用）
// ※この単元別画面では未使用。観点別画面を実装する際に到達度入力とあわせて使う。
const WORST_UNIT = {
  full:"が，とてもよくわかっています。",   // 到達度100%
  A:"を，もう一度見直しましょう。",
  B:"を，よく復習しましょう。",
  C:"を，基礎に戻って確認しましょう。"
};

// 学期制ごとの学期ラベル（仕様書 2.2）
const TERMS = {
  "3term":   ["1学期","2学期","3学期","年間"],
  "2term":   ["1学期","2学期","年間"],
  "2termHK": ["前期","後期","年間"]
};

const RANK = {A:1, B:2, C:3};


/* =====================================================================
 * 2. 診断文マスタ（教科別JSON）の読み込み・保持
 * ---------------------------------------------------------------------
 *  KANTEN_DB[subjectKey] = {
 *    subject, kantenOrder:[...], grades:{ "1":{ 観点:{A,B,C} } ... }
 *  }
 * ===================================================================== */

const KANTEN_DB = {};   // 読み込んだ教科別マスタを保持

async function loadKantenMaster(){
  const entries = await Promise.all(
    Object.keys(SUBJECTS).map(async key => {
      const res = await fetch(`data/${key}.json`);
      if(!res.ok) throw new Error(`${key}.json の読み込みに失敗 (${res.status})`);
      return [key, await res.json()];
    })
  );
  entries.forEach(([key, data]) => { KANTEN_DB[key] = data; });
}

// 教科の観点リスト（JSON由来）
function kantenList(subjectKey){
  return KANTEN_DB[subjectKey] ? KANTEN_DB[subjectKey].kantenOrder : [];
}

// 教科の対象学年リスト（JSON由来）
function gradeList(subjectKey){
  return KANTEN_DB[subjectKey] ? Object.keys(KANTEN_DB[subjectKey].grades).sort((a,b)=>a-b) : [];
}

// 観点別診断文の取得：教科 × 学年 × 観点 × 評価
function kantenSentence(subjectKey, grade, kanten, evalGrade){
  const db = KANTEN_DB[subjectKey];
  const g  = db && db.grades[String(grade)];
  const k  = g && g[kanten];
  return (k && k[evalGrade]) || `（${kanten} ${evalGrade} の診断文 未登録）`;
}


/* ---------------------------------------------------------------------
 * めあて(単元)マスタ data/meate_*.json の読み込み・保持
 *   MEATE_DB[subjectKey] = {
 *     subject, junkyoList:[...], grades:[...],
 *     data:{ 準拠:{ 学年:{ 学期:[ {no,name,meate,type?} ] } } }
 *   }
 * ------------------------------------------------------------------- */

const MEATE_DB = {};

async function loadMeateMaster(){
  const entries = await Promise.all(
    MEATE_SUBJECTS.map(async key => {
      const res = await fetch(`data/meate_${key}.json`);
      if(!res.ok) throw new Error(`meate_${key}.json の読み込みに失敗 (${res.status})`);
      return [key, await res.json()];
    })
  );
  entries.forEach(([key, data]) => { MEATE_DB[key] = data; });
}

// 指定教科・学年で「実際に単元が存在する準拠(教科書)」の一覧を返す
// 社会の地域版は学年が限定されるため、データを見て学年に該当する準拠だけを出す
function junkyoListFor(subjectKey, grade){
  const db = MEATE_DB[subjectKey];
  if(!db) return [];
  const g = String(grade);
  return db.junkyoList.filter(j => db.data[j] && db.data[j][g]);
}

// 指定教科・準拠・学年・学期の単元リストを返す（学期=年間なら全学期を連結）
function unitsFor(subjectKey, junkyo, grade, term){
  const db = MEATE_DB[subjectKey];
  if(!db) return [];
  const byGrade = db.data[junkyo] && db.data[junkyo][String(grade)];
  if(!byGrade) return [];

  if(isYear(term)){
    // 年間：1〜3学期(または前後期)の全単元を連結
    return Object.keys(byGrade).sort().flatMap(t => byGrade[t]);
  }
  return byGrade[termNumber(term)] || [];
}

// 学期ラベル("1学期"/"前期"等) → データ上の学期キー("1"/"2"/"3")
function termNumber(term){
  const map = {"1学期":"1","2学期":"2","3学期":"3","前期":"1","後期":"2"};
  return map[term] || "1";
}


/* =====================================================================
 * 3. 診断文生成エンジン（純粋ロジック・UIに依存しない）
 *  input = { subjectKey, grade, term, sogo, kanten:{}, units:[] }
 *  return = { red, green:[], blue }
 * ===================================================================== */

function isKokugo(subjectKey){ return subjectKey === "kokugo"; }
function isYear(term){ return term === "年間"; }

// 赤枠：総評
function buildRed(input){
  if(!input.sogo) return "（総合評価を選択してください）";
  if(isYear(input.term)){
    return SOGO_YEAR[input.sogo].replace("○年", input.grade + "年");
  }
  return SOGO_TERM[input.sogo].replace("○学期", input.term);
}

// 観点ごとに最も到達度の低い単元の文（仕様書 5.1：観点別診断文で使用）
// ※この単元別画面では未使用。観点別画面を実装する際に流用する想定。
//   その際は単元入力に到達度(reach)欄を再度設け、u.reach を渡すこと。
//   units の各要素は {name, meate, grade, reach?} を持つ前提。
function worstUnitSentence(input){
  const valid = input.units.filter(u => u.grade);
  if(valid.length === 0) return null;

  // 到達度100%の単元は専用文（観点別画面で到達度を入力する場合に有効）
  const full = valid.find(u => String(u.reach) === "100");
  if(full){
    return (full.meate || "") + WORST_UNIT.full;
  }
  let worst = null;
  valid.forEach(u => { if(!worst || RANK[u.grade] > RANK[worst.grade]) worst = u; });
  return (worst.meate || "") + WORST_UNIT[worst.grade];
}

// 緑枠：学習のようす
function buildGreen(input){
  const lines = [];
  const second = (input.term === "2学期" || input.term === "3学期" || input.term === "後期");

  // ① 2,3学期(後期)のみ：前学期比較（サンプルは固定文）
  if(!isYear(input.term) && second){
    lines.push({ord:"①前学期比較", text:"学習が定着しています。", note:"（前学期のABCと比較して自動判定）"});
  }

  // ② 観点別診断文（JSONから教科・学年・観点・評価で取得）
  const kEntries = Object.entries(input.kanten).filter(([,v]) => v);
  const kantenOrd = (!isYear(input.term) && second) ? "②観点" : "①観点";
  kEntries.forEach(([k, v]) => {
    lines.push({ord:kantenOrd, label:k, text:kantenSentence(input.subjectKey, input.grade, k, v)});
  });

  // ③ 単元別「学習のようす」：全単元を順に出力（算理社英のみ・仕様書 4.4）
  //    各単元の評価ABCに応じて「めあて＋接尾語」を生成する。
  //    units の各要素は {no, name, meate, grade} を持つ（教科書連動でセット済み）
  if(!isKokugo(input.subjectKey)){
    input.units.forEach(u => {
      if(!u.grade) return;                 // 評価未入力の単元はスキップ
      lines.push({
        ord:"単元",
        label: u.name || "",
        text: (u.meate || "") + UNIT_LEARN[u.grade]
      });
    });
  }
  return lines;
}

function generateDiagnosis(input){
  return {
    red:   buildRed(input),
    green: buildGreen(input),
    blue:  "1問ごとの○×入力が必要なため、本システムでは対象外です。"
  };
}


/* =====================================================================
 * 4. 画面制御（UI）
 * ===================================================================== */

const $ = sel => document.querySelector(sel);

const state = { sogo:null, kanten:{}, units:[] };

const els = {
  name:        $("#studentName"),
  grade:       $("#grade"),
  termType:    $("#termType"),
  subject:     $("#subject"),
  term:        $("#term"),
  junkyo:      $("#junkyo"),
  junkyoField: $("#junkyoField"),
  unitCard:    $("#unitCard")
};

function collectInput(){
  return {
    subjectKey: els.subject.value,
    grade:      els.grade.value,
    term:       els.term.value,
    sogo:       state.sogo,
    kanten:     state.kanten,
    units:      state.units
  };
}

// 教科セレクトをSUBJECTSから構築
function buildSubjectOptions(){
  els.subject.innerHTML = Object.entries(SUBJECTS)
    .map(([key,v]) => `<option value="${key}">${v.label}</option>`)
    .join("");
}

// 学年セレクトを教科の対象学年に合わせて構築
function rebuildGrades(){
  const subjectKey = els.subject.value;
  const grades = gradeList(subjectKey);
  const prev = els.grade.value;
  els.grade.innerHTML = grades.map(g => `<option value="${g}">${g}年</option>`).join("");
  if(grades.includes(prev)) els.grade.value = prev;
}

function rebuildTerms(){
  const list = TERMS[els.termType.value];
  const prev = els.term.value;
  els.term.innerHTML = list.map(t => `<option value="${t}">${t}</option>`).join("");
  if(list.includes(prev)) els.term.value = prev;
}

// 準拠(教科書)セレクトを「その教科・学年で単元が存在する準拠」で構築
function rebuildJunkyo(){
  const subjectKey = els.subject.value;
  if(isKokugo(subjectKey)){
    els.junkyoField.style.display = "none";
    return;
  }
  els.junkyoField.style.display = "";
  const list = junkyoListFor(subjectKey, els.grade.value);
  const prev = els.junkyo.value;
  els.junkyo.innerHTML = list.map(j => `<option value="${j}">${j}</option>`).join("");
  if(list.includes(prev)) els.junkyo.value = prev;
}

// 単元行を「教科・準拠・学年・学期」に対応した単元で再構築（算理社英のみ）
function rebuildUnits(){
  const subjectKey = els.subject.value;
  if(isKokugo(subjectKey)){
    els.unitCard.style.display = "none";
    state.units = [];
    return;
  }
  els.unitCard.style.display = "";
  const list = unitsFor(subjectKey, els.junkyo.value, els.grade.value, els.term.value);
  // state.units は単元情報＋評価を保持
  state.units = list.map(u => ({no:u.no, name:u.name, meate:u.meate, grade:null}));

  const termLabel = isYear(els.term.value) ? "年間" : els.term.value;
  $("#unitNote").innerHTML = list.length
    ? `<b>${els.junkyo.value}</b>・${els.grade.value}年・${termLabel}の単元（${list.length}件）。各単元の評価ABCに応じて<b>めあてと評価を組み合わせた診断文</b>を生成します。`
    : "該当する単元が登録されていません。";

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
    </tr>`).join("");
}

function rebuildForm(){
  const subjectKey = els.subject.value;

  rebuildGrades();
  rebuildJunkyo();

  // 観点ノート
  $("#kantenNote").innerHTML = isKokugo(subjectKey)
    ? "<b>国語</b>は単元別の診断文を持たず、<b>観点別診断文のみ</b>で「学習のようす（緑枠）」を構成します（観点8つ）。"
    : "「学習のようす（緑枠）」は<b>観点別診断文＋単元別評価</b>から組み立てます。";

  // 観点行（JSON由来の観点リスト）
  state.kanten = {};
  $("#kantenRows").innerHTML = kantenList(subjectKey).map(k => `
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

  // 単元行（教科書・学年・学期に連動）
  rebuildUnits();

  bindAbcButtons();
  render();
}

function bindAbcButtons(){
  document.querySelectorAll(".abc").forEach(group => {
    group.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        group.querySelectorAll("button").forEach(b => b.classList.remove("on"));
        btn.classList.add("on");
        const g = btn.dataset.g;
        if(group.id === "sogoAbc")                  state.sogo = g;
        else if(group.dataset.kanten !== undefined) state.kanten[group.dataset.kanten] = g;
        else if(group.dataset.unit   !== undefined) state.units[+group.dataset.unit].grade = g;
        render();
      });
    });
  });
}

function render(){
  const input = collectInput();
  const result = generateDiagnosis(input);
  const body = $("#pvBody");
  body.innerHTML = "";

  body.insertAdjacentHTML("beforeend",
    `<div class="frame red"><span class="ftag">総評（赤枠）</span><p>${result.red}</p></div>`);

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

  body.insertAdjacentHTML("beforeend",
    `<div class="frame blue"><span class="ftag">アドバイス（青枠）</span><p>${result.blue}</p></div>`);

  const label = SUBJECTS[input.subjectKey].label;
  $("#pvFoot").textContent =
    `${input.grade}年・${label}・${isYear(input.term) ? "年間" : input.term}` +
    (isKokugo(input.subjectKey) ? "｜国語：観点別のみ" : `｜準拠：${els.junkyo.value}`) +
    (isYear(input.term) ? "｜年間は最大4要素を連結" : "");
}

// ----- イベント登録 -----
// 教科変更：フォーム全体を作り直す
els.subject.addEventListener("change", rebuildForm);
// 学期制変更：学期セレクトを作り直し→単元（年間/学期で変わる）も更新
els.termType.addEventListener("change", () => { rebuildTerms(); rebuildUnits(); bindAbcButtons(); render(); });
// 学年変更：準拠(地域版は学年限定)と単元を作り直す
els.grade.addEventListener("change", () => { rebuildJunkyo(); rebuildUnits(); bindAbcButtons(); render(); });
// 学期変更：単元を作り直す
els.term.addEventListener("change", () => { rebuildUnits(); bindAbcButtons(); render(); });
// 準拠(教科書)変更：単元を作り直す
els.junkyo.addEventListener("change", () => { rebuildUnits(); bindAbcButtons(); render(); });
$("#confirmBtn").addEventListener("click", () => {
  const r = generateDiagnosis(collectInput());
  alert("診断文を登録しました（サンプル）。\n\n【総評】\n" + r.red +
        "\n\n【学習のようす】\n" + r.green.map(l => (l.label?l.label+"：":"") + l.text).join("\n"));
});

// ----- 初期化（JSON読み込み後にフォーム構築） -----
async function init(){
  try{
    await Promise.all([loadKantenMaster(), loadMeateMaster()]);
  }catch(e){
    $("#pvBody").innerHTML =
      `<div class="frame red" style="margin:14px 16px"><span class="ftag">読み込みエラー</span>` +
      `<p>${e.message}<br>※ブラウザでファイルを直接開くとJSONを読めません。フォルダ内で「python3 -m http.server」等を起動し、http経由で開いてください。</p></div>`;
    return;
  }
  buildSubjectOptions();
  els.subject.value = "sansu";
  rebuildTerms();
  rebuildForm();
}
init();
