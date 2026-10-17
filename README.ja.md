<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

# 🪁 Kites

### どんな言語のマンガも、ブラウザ上でそのまま読める。
**Python不要 • サーバー通信ゼロ • 100% 完全ローカル＆プライベートなブラウザ拡張機能 AI 翻訳**

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Free_Install-4285F4.svg?style=flat-square&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-success.svg?style=flat-square&logo=googlechrome&logoColor=white)](manifest.json)
[![WebGPU](https://img.shields.io/badge/Hardware-WebGPU%20Accelerated-orange.svg?style=flat-square&logo=webgpu&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
[![Vite](https://img.shields.io/badge/Built%20with-React%2019%20%2B%20Vite-646CFF.svg?style=flat-square&logo=vite&logoColor=white)](package.json)

<br/>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb">
    <img src="https://img.shields.io/badge/Available_in_the-Chrome_Web_Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Available in the Chrome Web Store" height="42" />
  </a>
  &nbsp;&nbsp;
  <a href="https://github.com/Unheat/Kites/releases/latest">
    <img src="https://img.shields.io/badge/GitHub_Releases-Download_.zip-24292e?style=for-the-badge&logo=github&logoColor=white" alt="Download Release .zip" height="42" />
  </a>
</p>

<br/>

[![Kites Hero Banner](./README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg)](./README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg)

</div>

---

## 💡 なぜ Kites なのか？

従来のマンガ翻訳ツールは、複雑な Python 環境の構築やギガバイト単位の CUDA パッケージの導入が必要だったり、個人の閲覧履歴を外部クラウドサーバーにアップロードする必要がありました。

**Kites はそれを一変させます。** 最先端の画像認識および大規模言語モデルを、**WebGPU 経由でお使いの GPU 上で直接実行**する軽量な Chrome 拡張機能です。

- ⚡ **セットアップ不要：** [Chrome ウェブストア](https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb) から 1 クリックでインストールしてすぐ使えます。コマンドライン、Python、追加の環境構築は一切不要です。
- 🔒 **100% ローカル＆プライベート：** 文字認識 (OCR) と背景のテキスト消去はすべてお使いのデバイス上で完結。画像がブラウザの外に送信されることはありません。
- 🎨 **インテリジェントな背景修復：** 線画、スクリーントーン、テクスチャの質感を損なうことなく、AI インペインティングで元の文字だけを綺麗に消去します。
- ✍️ **自然な写植・タイポグラフィ：** 吹き出しのサイズを自動計測し、適切な改行バランス、フォントサイズ、文字・縁取りカラーを美しく自動調整します。
- 🗨️ **吹き出し形状へのスマート適応 (Smart Bubble Fit)：** 高度な吹き出し検出（ヒューリスティックおよび YOLO 神経網）により、縦長になりがちな CJK のテキスト領域を広々とした吹き出し全体へ自然に拡張。極小文字への押しつぶしを防止します。
- 📜 **縦スクロール Webtoon 完全対応：** 1D インメモリキャンバス分割処理により、超長尺の縦スクロールマンガ（$>14,000\text{ px}$）も原寸解像度のままシームレスに翻訳。
- 🛠️ **内蔵 Kites Studio：** 訳文の微調整、吹き出しのリサイズ、フォントスタイルの変更などをブラウザ上でそのまま手軽に行えます。

---

## 🖼️ 実際の動作デモ

### 日本語 → 英語 (Japanese → English)
> *作品: 佐藤さんは知っていた by [@09ra_19ra](https://x.com/09ra_19ra)*

<div align="center">
<table>
  <tr>
    <th width="50%" align="center">日本語原文 (Original Japanese)</th>
    <th width="50%" align="center">Kites 翻訳後 (Kites Translated)</th>
  </tr>
  <tr>
    <td align="center">
      <img src="./README_images/input/demo2.jpeg" alt="Original Japanese Manga" width="100%" />
    </td>
    <td align="center">
      <img src="./README_images/result/demo2_result.png" alt="Kites English Translation" width="100%" />
    </td>
  </tr>
</table>
</div>

### 日本語 → ベトナム語 (Japanese → Vietnamese)
> *出典: [Pixiv Artwork #145272482](https://www.pixiv.net/en/artworks/145272482)*

<div align="center">
<table>
  <tr>
    <th width="50%" align="center">日本語原文 (Original Japanese)</th>
    <th width="50%" align="center">Kites 翻訳後 (Kites Translated)</th>
  </tr>
  <tr>
    <td align="center">
      <img src="./README_images/input/demo7.jpg" alt="Original Japanese Manga" width="100%" />
    </td>
    <td align="center">
      <img src="./README_images/result/demo7_result.png" alt="Kites Vietnamese Translation" width="100%" />
    </td>
  </tr>
</table>
</div>

---

## 🖱️ インプレース即時翻訳

Twitter/X、Pixiv、各種マンガ配信サイトのコマ上にマウスを乗せるだけ。CSS Anchor Positioning によるスマートな翻訳バッジが浮き上がり、クリックひとつでコマ上のセリフが直接翻訳されます。コピペの手間は一切不要です。

<div align="center">
  <img src="./README_images/UI-feature/hover-inplace-preview.png" alt="Kites In-Page Hover Translation Button" width="620px" />
</div>

- 🖱️ **ホバー翻訳 (Hover)：** マンガのコマにカーソルを合わせるだけで即座に翻訳。
- 📌 **常時表示 (Persistent)：** ページ内のすべての画像に翻訳バッジを常に表示。
- 🚀 **自動翻訳 (Auto-Translate)：** ページをスクロールするだけで、画面内に現れたコマを自動検出して翻訳。
- ✂️ **画面クロップ翻訳 (Screen Crop)：** 右クリックメニューまたは `Ctrl/Alt + Shift + X` で、保護された Canvas、WebGL ゲーム、画面上の任意範囲を切り抜いて翻訳。
- ⚡ **閲覧ショートカットキー：** `F` キーで原文を瞬時にプレビュー、`Ctrl/Alt + Shift + Z` でホバー中の画像を即時翻訳、`Ctrl/Alt + Shift + M` でチャプターリーダーを素早く起動。
- 🎯 **右クリックメニュー：** ブラウザのコンテキストメニューからウェブ上のあらゆる画像をいつでも翻訳。

---

## 📖 チャプターリーダー＆高速スキャン

マンガや Webtoon の 1 話全体を、集中しやすい専用ビューで快適に読書：遅延読み込み画像の自動バッチ検出、シームレスな縦スクロール表示、複数ページの並列翻訳、オフライン ZIP エクスポートに対応：

[![Kites Chapter Reader](./README_images/UI-feature/reader.jpg)](./README_images/UI-feature/reader.png)

- **高速スキャン (Fast Scan)：** ページを自動スクロールしながら、遅延読み込み（lazy-load）されるコマをすべて検知して翻訳キューに追加。
- **多彩なリーダー表示：** Webtoon の連続縦スクロール、単ページ表示、見開き 2 ページ表示を自在に切り替え。
- **1 話丸ごと一括翻訳：** 進捗バー付きで 1 話全体をワンクリック翻訳。キャッシュ機能でオフラインでも安心。
- **1 クリックで ZIP 保存：** 翻訳済みの全ページを番号順に整理された ZIP ファイルとしてワンクリック保存。サーバーへのアップロードなしでオフライン保存・アーカイブが可能です。

---

## 🛠️ 内蔵 Kites Studio

翻訳を推敲したり、文字配置をこだわりたいですか？ 拡張機能からフルスクリーンの **Kites Studio** を直接起動できます。

[![Kites Studio](./README_images/UI-feature/kite_studio_editing.jpg)](./README_images/UI-feature/studio-editor.png)

- **インライン直接編集：** 吹き出しをダブルクリックするだけでその場でセリフを修正可能。サブピクセル単位の垂直中央揃えと自動リフローに対応。
- **直感的なキャンバス操作：** 8 点ハンドルで吹き出しの位置やサイズを自由に調整。
- **ローカル AI 修復ブラシ (Inpaint Brush)：** ブラシ操作で、画像の乱れ、吹き出し、未翻訳の描き文字（擬音・SFX）を高精度に消去。
- **ビフォーアフター比較：** 原文画像、消去後（クリーン）、写植後の各レイヤーをワンクリックで瞬時に比較切り替え。
- **タイポグラフィ調整：** フォントサイズ、文字色、配置揃え、行間をリアルタイムに調整。
- **ワンクリック高解像度出力：** 元画像の解像度を維持したまま、綺麗な翻訳画像をエクスポート。

---

## 🎛️ ポップアップ操作と設定

直感的なポップアップ画面から、翻訳先言語、ニューラル OCR モデル、背景消去アルゴリズムを自由にカスタマイズ：

<div align="center">
<table>
  <tr>
    <th width="33%" align="center">クイック操作パネル (Quick Control)</th>
    <th width="33%" align="center">チャプターリーダー＆スキャナー</th>
    <th width="34%" align="center">エンジン・モデル詳細設定</th>
  </tr>
  <tr>
    <td align="center">
      <img src="./README_images/UI-feature/main-panel.jpg" alt="Kites Main Popup" width="95%" />
    </td>
    <td align="center">
      <img src="./README_images/UI-feature/reader-panel.jpg" alt="Kites Chapter Reader and Scanner Panel" width="95%" />
    </td>
    <td align="center">
      <img src="./README_images/UI-feature/setting-panel.jpg" alt="Kites Settings Panel" width="95%" />
    </td>
  </tr>
</table>
</div>

- **カスタム用語集 (Custom Glossary)：** キャラクター名、敬称、専門用語をあらかじめ登録し、ローカルおよびクラウド LLM の翻訳精度を向上。
- **ドメイン別ルール：** ドメインごとに CSS セレクターを個別指定したり、機能の有効/無効を設定。

---

## 🧠 最新の AI テクノロジーを搭載

| コンポーネント | 選択可能なエンジン | 説明 |
| :--- | :--- | :--- |
| **翻訳 (Translation)** | **WebLLM** *(ローカル WebGPU)*<br/>**クラウド共有プール** *(1日100回無料)*<br/>**Google 翻訳**<br/>**カスタム API** *(OpenAI, Claude, Gemini)* | ブラウザ内で無制限のローカル LLM（Qwen 3.5、Qwen 3、Gemma 3、Llama 3.2）を実行、コミュニティ共有クラウド（1日100回無料）、またはお手持ちの API キーを連携。 |
| **背景修復 (Inpainting)** | **LaMa Manga** *(ニューラルモデル)*<br/>**AOT-GAN** *(高速ニューラル)*<br/>**Telea Diffusion** *(即時)*<br/>**シンプル塗りつぶし (Simple Fill)** | 文字の境界内を厳密に消去し、マンガの主線やトーンを最大限に保護。 |
| **文字認識 (OCR)** | **PaddleOCR v3 – v6** | 多言語に対応した業界標準の高精度テキスト検出・認識。長尺 Webtoon の 1D 分割結合にも対応。 |
| **吹き出しフィッティング (Bubble Fit)** | **Neural YOLO** *(WebGPU)*<br/>**ヒューリスティック (Heuristic)** *(即時)*<br/>**Classic MST** | 吹き出しの「しっぽ」部分を自動分離し、自然な余白領域全体へ文字を美しく配置。文字の潰れを解消します。 |

---

## 🚀 クイックスタート・インストール

### 方法 1: Chrome ウェブストア（推奨 • 1 クリックインストール）

公式かつ最も簡単なインストール方法です。バックグラウンド自動アップデートと Google のセキュリティ審査を含みます：

<div align="left">
  <a href="https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb">
    <img src="https://img.shields.io/badge/Add_to_Chrome-Free_Install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Add to Chrome" height="38" />
  </a>
</div>

1. **[Chrome ウェブストアの Kites ページ](https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb)** を開きます。
2. **Chrome に追加** をクリックし、インストールの確認を承認します。
3. すぐにアクセスできるように **Kites** をブラウザのツールバーに固定します。
4. Twitter/X、Pixiv、MangaDex などで任意のマンガを開き、コマにマウスを合わせて翻訳を開始します！

---

### 方法 2: ビルド済み ZIP（手動読み込み — ターミナル不要）

オフライン環境、手動テスト、または特定のリリースの動作確認に最適です：

1. 最新の GitHub リリースから **[`kites.zip`](https://github.com/Unheat/Kites/releases/latest)** をダウンロードします。
2. ダウンロードした `.zip` ファイルをお使いの PC のフォルダに展開します。
3. Chrome で `chrome://extensions/` を開きます。
4. 右上の **デベロッパー モード (Developer mode)** をオンにします。
5. 左上の **パッケージ化されていない拡張機能を読み込む (Load unpacked)** をクリックし、展開したフォルダを選択します。
6. **Kites** をツールバーに固定すれば、すぐにマンガを読み始められます！

---

### 方法 3: ソースコードからビルド（開発者向け）

```bash
# 1. リポジトリをクローン
git clone https://github.com/Unheat/Kites.git
cd Kites

# 2. 依存関係のインストールとビルド
npm ci
npm run build
```

1. Chrome で `chrome://extensions/` を開きます。
2. 右上の **デベロッパー モード** をオンにします。
3. **パッケージ化されていない拡張機能を読み込む** をクリックし、生成された `dist/` フォルダを選択します。
4. **Kites** をツールバーに固定してデバッグ・閲覧を開始します！

---

## 🤝 コントリビューション・ドキュメント

開発者、翻訳者、マンガを愛するすべての方々からの貢献を心より歓迎します！

- 📖 **[ドキュメントハブ](docs/README.md)** — アーキテクチャ図、処理パイプライン仕様、ランタイム設計。
- 📐 **[インタラクティブ・パイプラインマップ](docs/workflow.html)** — Kites のテキスト検出、背景消去、写植アルゴリズムの流れを体験できる視覚化ツール。
- 🛠️ **[コントリビューションガイド](CONTRIBUTING.md)** — 開発環境の構築、テストの実行、プルリクエストの提出方法。

---

## 📜 ライセンス・謝辞

Kites は **[GNU General Public License v3.0](LICENSE)** のもとで公開されています。

Kites の実現に不可欠だった素晴らしいオープンソースプロジェクトに心より感謝申し上げます：
- **[manga-image-translator (Cotrans)](https://github.com/zyddnys/manga-image-translator):** 画期的な空間テキストグループ化および写植レンダリングアルゴリズム。
- **[xianscan-rust](https://github.com/ArbenApura/xianscan-rust):** 動的パッチインペインティングアーキテクチャおよび OCR ノイズ除去フィルター。
- **[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR):** 高速かつ高精度な多言語ニューラルテキスト検出・認識モデル。
- **[@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm):** 大規模言語モデル向けのブラウザネイティブ WebGPU 推論ランタイム。

---

<div align="center">
  <sub>マンガやコミックを愛するすべての人へ、❤️ を込めて。快適な読書体験を楽しんでいただけたら、ぜひ GitHub で ⭐ Star をお願いします！</sub>
</div>
