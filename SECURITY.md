# Security

脆弱性は公開Issueへ機微情報を書かず、GitHubのPrivate vulnerability reportingから報告してください。

## Boundaries

- 内容保存API、アカウント、Cookie、公開プロフィールなし
- GPS、カメラ、マイク、決済権限なし
- 同一Origin・allowlist・1KB上限の匿名イベントAPI
- CSP、frame拒否、MIME sniffing拒否
- 読み込みファイルは形式、件数、UUID、参照、日付、サイズ、写真対応を検証
- CSVは先頭の数式文字を無害化
- 写真はブラウザ内で再描画してEXIFを除去

釣り場の規則、安全、立入可否、気象・潮位を判断する機能は提供しません。
