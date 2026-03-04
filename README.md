# ad-filter Chrome 拡張

この拡張は、表示中の Web ページに対して以下を行います。

- 一定長以上のテキストをブロック単位で外部 API 判定
- 判定完了まで `#` でマスク表示
- 判定 `OK` は元テキストを復元、`NG` はマスク維持
- 画像 (`img`) を白い空画像に差し替え

## 使い方

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパー モード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」からこのフォルダを選択

## 設定変更

`content.js` で以下を変更できます。

```js
const MIN_TEXT_LENGTH = 20;
const MASK_CHAR = "#";
```

`background.js` で判定 API を変更できます。

```js
const API_ENDPOINT = "https://example.com/ad-filter/judge";
```

API は `POST` で `{ "text": "..." }` を受け取り、`{ "ok": true/false }` を返す前提です。
