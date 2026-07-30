# Product metrics

D1へ保存するのはイベント名、ランダムなv4 UUID、JST日付、発生時刻、QAフラグだけです。入力内容や件数をイベントpayloadに含めません。45日を超えた行はscheduled handlerで削除します。

| Event              | Meaning                  |
| ------------------ | ------------------------ |
| `visited`          | アプリを開いた           |
| `trip_created`     | 釣行を1件作成した        |
| `catch_added`      | 釣果を1件追加した        |
| `share_card_saved` | 位置なし共有札を保存した |
| `printed`          | 印刷/PDFを起動した       |
| `project_exported` | `.chokato`を書き出した   |
| `project_imported` | `.chokato`を読み込んだ   |
| `returned`         | 別日に再訪した           |

QAは`x-choka-qa: 1`で分離し、公開前確認後に削除します。
