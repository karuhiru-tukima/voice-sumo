# オンライン対戦・レート・ランキングの準備（Firebase）

オンライン対戦、友達対戦、レート、ランキングには Firebase を使います。稽古場は通信なしで利用できます。

設定済みプロジェクト: `voice-sumo-20261127`（Sparkプラン）。
公開ページ: https://karuhiru-tukima.github.io/voice-sumo/
レート・ランキング・相手さがしにはFirestore、取組の通信にはRealtime Databaseを使います。

所要時間：15分くらい。Google アカウントが必要です。無料プラン（Spark）の範囲で動きます。

---

## 1. プロジェクトを作る
1. https://console.firebase.google.com を開いて Google アカウントでログイン
2. 「プロジェクトを作成」→ 名前は何でもOK（例：`voice-sumo`）
3. Google アナリティクスは「無効」でOK → 作成

## 2. 匿名ログインをオンにする
（端末ごとに自動でIDを作り、レートをその端末に紐付けるために使います）
1. 左メニュー「構築」→「Authentication」→「始める」
2. 「Sign-in method」タブ →「匿名」を選んで **有効にする** → 保存

## 2-2. Googleログインをオンにする（記録をGoogleアカウントに残すため）
1. 「Authentication」→「Sign-in method」タブ →「新しいプロバイダを追加」→「Google」
2. **有効にする** → 「プロジェクトのサポートメール」に自分のアドレスを選ぶ → 保存
3. 「Authentication」→「設定」タブ →「承認済みドメイン」→「ドメインの追加」で
   **`karuhiru-tukima.github.io`** を追加
   （これが無いと、公開ページで「承認済みドメインに入っていません」と出てログインできません）

## 3. データベース（Firestore）を作る
1. 左メニュー「構築」→「Firestore Database」→「データベースの作成」
2. 場所は `asia-northeast1（東京）` がおすすめ
3. 「本番環境モードで開始」を選んで作成

## 4. ルールを貼る
1. Firestore の画面の「ルール」タブを開く
2. 中身をすべて消して、このフォルダの **`firestore.rules`** の中身を貼り付け →「公開」

友達対戦と取組の通信にはRealtime Databaseも必要です。`asia-southeast1` に作成し、`database.rules.json` を適用します。`firebase-config.js` の `databaseURL` はそのデータベースのURLです。

## 5. 設定値をコピーする
1. 左上の歯車 →「プロジェクトの設定」
2. 下の「マイアプリ」で **`</>`（ウェブ）** を押す → ニックネームは何でもOK →「アプリを登録」
   （Firebase Hosting のチェックは不要）
3. 表示された `const firebaseConfig = { ... };` の `{ ... }` の部分をコピー
4. このフォルダの **`firebase-config.js`** を開いて、

   ```js
   window.FIREBASE_CONFIG = null;
   ```

   を、次のように書き換えて保存：

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "（コピーした値）",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   ```

   ※ この apiKey は公開される前提の値なので、ページに載っていても問題ありません（守りは手順4のルールが担当）。

## 6. 公開して2台で開く
スマホのマイクは **https のページ** で使ってください。

GitHubの `karuhiru-tukima/voice-sumo` のmainブランチをGitHub Pagesで公開しています。
`index.html`、`firebase-config.js`、`firebase-relay.js` を同じフォルダに配置します。
https://karuhiru-tukima.github.io/voice-sumo/ を2台で開き、マイクの使用を許可してください。
更新後は両方の端末で再読み込みし、新しく部屋を作ってください。
`.claude`、`.codex-tools`、`.codex-backups`、ログは公開しません。

---

## 動きの仕組み（参考）
- **オンライン対戦**：押した人はFirestoreの `queue` に「待っています」と書きます。後から押した人がそれを見つけて取り合い、1組だけ成立したらRealtime Database経由で取組の状態を同期します。マイクの音声は送信せず、音量・準備状態・勝敗だけを送ります。
- **レート**：最初は 0 で、0 より下がりません。1番ごとに変動します（イロレーティング、K=32）。強い相手に勝つほど多く上がります。
- **記録の保存先**：レート・戦績・稽古場の自己ベストは Firestore の `players` に保存されます。サイト（GitHub Pages）やブラウザのデータを消しても、Firebase のプロジェクトを消さない限り残ります。
- **Googleログイン**：ログインすると、それまでの記録がそのままGoogleアカウントに引き継がれます。別の端末やブラウザでも、同じGoogleアカウントでログインすれば同じ記録に戻ります。
- **取組中に抜けた場合**：抜けた側は負け、残った側は不戦勝になります。
- **友達対戦**：部屋番号でつなぐだけで、レートは変わりません。

## 注意
- レートはそれぞれの端末が自分の分を書き込む仕組みなので、本気でズルをする人は防げません。友達や学内で遊ぶ前提の作りです。
- Googleログインしていない（匿名の）間は「ブラウザ」単位です。ブラウザのデータを消したり別のブラウザで開いたりすると、新しい力士（レート0）になります。記録を残したい人はGoogleでログインしてください。
- LINEやInstagramなどのアプリ内ブラウザでは、GoogleがログインをブロックすることがあるのでSafariかChromeで開いてください。
