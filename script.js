document.getElementById('diagnosisForm').addEventListener('submit', function(e) {
    e.preventDefault();

    // 入力値の取得
    const name = document.getElementById('studentName').value;
    const scores = {
        japanese: parseInt(document.getElementById('japanese').value),
        math: parseInt(document.getElementById('math').value),
        science: parseInt(document.getElementById('science').value),
        social: parseInt(document.getElementById('social').value)
    };

    // 診断文の生成
    const diagnosis = generateDiagnosis(name, scores);

    // 結果の表示
    const resultArea = document.getElementById('resultArea');
    const output = document.getElementById('diagnosisOutput');
    
    output.innerText = diagnosis;
    resultArea.classList.remove('hidden');
});

/**
 * 診断ロジック（資料に基づいた生成アルゴリズム）
 */
function generateDiagnosis(name, scores) {
    let text = `${name}さんの学習状況についての診断結果をお伝えします。\n\n`;

    // 平均点の計算
    const average = (scores.japanese + scores.math + scores.science + scores.social) / 4;

    // 1. 全体評価
    if (average >= 85) {
        text += "【全体評】全教科において非常に高い理解度を示しており、応用問題への挑戦意欲も素晴らしいです。";
    } else if (average >= 65) {
        text += "【全体評】概ね基礎事項は定着しています。苦手分野を克服することでさらに伸びる可能性があります。";
    } else {
        text += "【全体評】まずは基礎的な知識の定着に重点を置く必要があります。反復学習を心がけましょう。";
    }
    text += "\n\n";

    // 2. 個別教科評価（ロジックの例）
    const subjects = [
        { name: '国語', score: scores.japanese, plus: '読解力が安定しています。', minus: '語彙力の強化が課題です。' },
        { name: '算数', score: scores.math, plus: '論理的な思考ができています。', minus: '計算ミスに注意が必要です。' },
        { name: '理科', score: scores.science, plus: '観察眼が鋭く、原理の理解が早いです。', minus: '用語の暗記を徹底しましょう。' },
        { name: '社会', score: scores.social, plus: '資料の読み取りが得意です。', minus: '歴史の前後関係を整理しましょう。' }
    ];

    text += "【教科別アドバイス】\n";
    subjects.forEach(sub => {
        const comment = sub.score >= 70 ? sub.plus : sub.minus;
        text += `・${sub.name}: ${comment}\n`;
    });

    // 3. 結びの言葉
    text += `\n今後の更なる成長を期待しています。`;

    return text;
}