import { Hono } from "hono";
import type { Child } from "hono/jsx";
import { requestId } from "hono/request-id";

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
};

type Variables = { requestId: string };
type AppContext = Parameters<Parameters<typeof app.use>[1]>[0];

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const canonicalOrigin = "https://choka-to.yhay81.com";
const eventLifetime = 45 * 86400;
const eventNames = new Set([
  "visited",
  "trip_created",
  "catch_added",
  "share_card_saved",
  "printed",
  "project_exported",
  "project_imported",
  "returned",
]);
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const jstDay = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

const securityHeaders = async (c: AppContext, next: () => Promise<void>) => {
  await next();
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'",
  );
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
};

const Layout = ({
  canonical,
  children,
  description,
  script,
  title,
}: {
  canonical: string;
  children: Child;
  description: string;
  script?: string;
  title: string;
}) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta content="width=device-width, initial-scale=1" name="viewport" />
      <meta content="#0b3441" name="theme-color" />
      <meta content={description} name="description" />
      <meta content={description} property="og:description" />
      <meta content={`${canonicalOrigin}/og.svg`} property="og:image" />
      <meta content="水面の下に魚影と釣果札が並ぶ釣果灯の記録盤" property="og:image:alt" />
      <meta content="ja_JP" property="og:locale" />
      <meta content={title} property="og:title" />
      <meta content="website" property="og:type" />
      <meta content={canonical} property="og:url" />
      <meta content="summary_large_image" name="twitter:card" />
      <link href={canonical} rel="canonical" />
      <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
      <link href="/manifest.webmanifest" rel="manifest" />
      <link href="/styles.css" rel="stylesheet" />
      {script ? <script src={script} type="module"></script> : null}
      <title>{title}</title>
    </head>
    <body>
      <a class="skip-link" href="#main">
        本文へ移動
      </a>
      <header class="site-header">
        <a class="brand" href="/" aria-label="釣果灯 ホーム">
          <span class="brand-float" aria-hidden="true">
            <i></i>
          </span>
          <span>釣果灯</span>
        </a>
        <nav aria-label="メイン">
          <a href="/guide">使い方</a>
          <a href="/privacy">保存先</a>
        </nav>
      </header>
      {children}
      <footer>
        <span>釣果灯</span>
        <span>釣り場を外へ出さない、水辺の記録盤</span>
      </footer>
    </body>
  </html>
);

const TripForm = () => (
  <form class="trip-form" data-trip-form>
    <input name="tripId" type="hidden" />
    <label>
      釣行の呼び名
      <input maxlength={48} name="title" placeholder="朝まずめの堤防" required />
    </label>
    <div class="field-pair">
      <label>
        日付
        <input name="date" required type="date" />
      </label>
      <label>
        水辺
        <select name="water" required>
          <option value="sea">海・堤防</option>
          <option value="boat">船</option>
          <option value="river">川・渓流</option>
          <option value="lake">湖</option>
          <option value="pond">池・管理釣り場</option>
          <option value="other">その他</option>
        </select>
      </label>
    </div>
    <div class="field-pair">
      <label>
        開始
        <input name="startedAt" type="time" />
      </label>
      <label>
        終了
        <input name="endedAt" type="time" />
      </label>
    </div>
    <label>
      自分だけの場所メモ
      <input maxlength={64} name="spotLabel" placeholder="東側の足場 / 上流の木陰" />
    </label>
    <div class="field-pair">
      <label>
        空と水の様子
        <input maxlength={80} name="condition" placeholder="曇り、下げ潮、濁りあり" />
      </label>
      <label>
        仕掛け・タックル
        <input maxlength={120} name="tackle" placeholder="ロッド、リール、ライン" />
      </label>
    </div>
    <label>
      釣行メモ
      <textarea maxlength={600} name="note" placeholder="反応があった時間、次に試すこと"></textarea>
    </label>
    <p class="privacy-note">
      GPS座標は扱いません。場所メモを含む入力内容は、このブラウザの中だけに残ります。
    </p>
    <button class="primary-button" type="submit">
      <span class="button-float" aria-hidden="true"></span>
      <span data-trip-submit-label>水辺へ出る</span>
    </button>
    <p class="form-state" data-trip-state></p>
  </form>
);

const HomePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/`}
    description="釣行、魚種、サイズ、仕掛け、写真を、釣り場の位置を送らず端末内だけで記録する水辺の釣果盤。"
    script="/app.js"
    title="釣果灯｜釣り場を外へ出さない釣果記録"
  >
    <main class="water-log" data-page="water-log" id="main">
      <section class="first-water" data-empty-log>
        <div class="water-scene" aria-label="朝の水面と釣り浮き、魚影">
          <div class="sky-disc"></div>
          <div class="far-bank"></div>
          <div class="near-bank"></div>
          <div class="float-line">
            <span></span>
            <i></i>
          </div>
          <div class="surface-ripple one"></div>
          <div class="surface-ripple two"></div>
          <span class="fish-shadow fish-one"></span>
          <span class="fish-shadow fish-two"></span>
          <span class="fish-shadow fish-three"></span>
        </div>
        <div class="first-trip">
          <p class="eyebrow">FIRST CAST</p>
          <h1>最初の釣行を置く</h1>
          <p>釣れた時刻と仕掛けを重ねると、水の中に自分だけの傾向が見えてきます。</p>
          <TripForm />
        </div>
      </section>

      <section class="log-workspace" data-log-workspace hidden>
        <div class="trip-rail">
          <div class="trip-tabs" data-trip-tabs aria-label="釣行一覧"></div>
          <button class="rail-add" data-action="add-trip" type="button">
            ＋ 釣行を追加
          </button>
        </div>

        <section class="catch-board" aria-label="現在の釣行">
          <div class="trip-identity">
            <div class="water-badge" data-water-badge aria-hidden="true">
              <span></span>
              <i></i>
            </div>
            <div>
              <p class="eyebrow">AT THE WATER</p>
              <h1 data-trip-title></h1>
              <p data-trip-summary></p>
            </div>
          </div>
          <div class="board-stat">
            <span>CATCH</span>
            <strong data-catch-total>0</strong>
            <small>匹</small>
          </div>
          <div class="board-stat">
            <span>SPECIES</span>
            <strong data-species-total>0</strong>
            <small>種</small>
          </div>
          <div class="board-stat best-stat">
            <span>BEST LENGTH</span>
            <strong data-best-length>—</strong>
            <small>cm</small>
          </div>
          <div class="water-column" data-water-column aria-label="釣れた時間帯の魚影"></div>
        </section>

        <div class="log-actions">
          <button class="primary-button" data-action="add-catch" type="button">
            <span class="button-float" aria-hidden="true"></span>
            釣果を記録
          </button>
          <button data-action="edit-trip" type="button">
            釣行を編集
          </button>
          <button data-action="print" type="button">
            釣行票を印刷 / PDF
          </button>
          <details class="carry-menu">
            <summary>持ち出す・戻す</summary>
            <div>
              <button data-action="export-project" type="button">
                写真込み .chokato
              </button>
              <button data-action="export-csv" type="button">
                表計算用 CSV
              </button>
              <label class="file-button">
                .chokatoを読み込む
                <input accept=".chokato,application/json" data-import-file type="file" />
              </label>
            </div>
          </details>
          <button class="danger-button" data-action="delete-trip" type="button">
            この釣行を削除
          </button>
        </div>

        <div class="log-grid">
          <section class="catch-stream">
            <div class="section-heading">
              <div>
                <p class="eyebrow">CATCH STREAM</p>
                <h2>水辺の記録</h2>
              </div>
              <span data-catch-count>0件</span>
            </div>
            <div class="catch-filter">
              <label>
                <span>状態</span>
                <select data-catch-disposition>
                  <option value="all">すべて</option>
                  <option value="released">リリース</option>
                  <option value="kept">持ち帰り</option>
                  <option value="lost">バラシ・観察</option>
                </select>
              </label>
              <label>
                <span>検索</span>
                <input data-catch-search placeholder="魚種・ルアー・メモ" type="search" />
              </label>
            </div>
            <div class="catch-list" data-catch-list></div>
            <div class="catch-empty" data-catch-empty>
              <div class="empty-water" aria-hidden="true">
                <span></span>
                <i></i>
              </div>
              <p>最初の一匹を置くと、時刻順に魚影が並びます。</p>
            </div>
          </section>

          <aside class="pattern-dock">
            <section class="trip-note-card">
              <div class="section-heading compact">
                <div>
                  <p class="eyebrow">FIELD NOTE</p>
                  <h2>この日の手がかり</h2>
                </div>
              </div>
              <dl>
                <div>
                  <dt>場所メモ</dt>
                  <dd data-trip-spot>—</dd>
                </div>
                <div>
                  <dt>空と水</dt>
                  <dd data-trip-condition>—</dd>
                </div>
                <div>
                  <dt>仕掛け</dt>
                  <dd data-trip-tackle>—</dd>
                </div>
              </dl>
              <p data-trip-note></p>
            </section>
            <section class="species-card">
              <div class="section-heading compact">
                <div>
                  <p class="eyebrow">ALL TRIPS</p>
                  <h2>魚種の並び</h2>
                </div>
              </div>
              <div class="species-chart" data-species-chart></div>
            </section>
            <section class="month-card">
              <div class="section-heading compact">
                <div>
                  <p class="eyebrow">12 MONTHS</p>
                  <h2>釣行の波</h2>
                </div>
              </div>
              <div class="month-ripples" data-month-chart></div>
            </section>
          </aside>
        </div>

        <section class="local-flow" aria-label="データの保存先">
          <div>
            <span class="flow-fish">◖</span>
            <strong>釣行・釣果・写真</strong>
          </div>
          <span class="flow-arrow">→</span>
          <div class="browser-box">
            <span>この端末</span>
            <strong>IndexedDB</strong>
          </div>
          <span class="flow-stop">×</span>
          <div>
            <span class="flow-cloud">☁</span>
            <strong>内容の送信なし</strong>
          </div>
        </section>

        <button class="empty-log-button" data-action="clear-log" type="button">
          すべての記録を消す
        </button>
      </section>

      <dialog class="water-dialog" data-trip-dialog>
        <form method="dialog">
          <button aria-label="閉じる" class="dialog-close" value="cancel">
            ×
          </button>
        </form>
        <p class="eyebrow" data-trip-dialog-kicker>
          NEW WATER
        </p>
        <h2 data-trip-dialog-title>釣行を追加</h2>
        <TripForm />
      </dialog>

      <dialog class="water-dialog catch-dialog" data-catch-dialog>
        <form class="catch-form" data-catch-form>
          <button aria-label="閉じる" class="dialog-close" data-action="close-catch" type="button">
            ×
          </button>
          <p class="eyebrow">CATCH TAG</p>
          <h2>一匹を記録する</h2>
          <div class="field-pair">
            <label>
              時刻
              <input name="caughtAt" required type="time" />
            </label>
            <label>
              魚種
              <input maxlength={48} name="species" placeholder="シーバス" required />
            </label>
          </div>
          <div class="field-triple">
            <label>
              匹数
              <span class="unit-input">
                <input max="999" min="1" name="count" required type="number" value="1" />
                <b>匹</b>
              </span>
            </label>
            <label>
              長さ
              <span class="unit-input">
                <input max="999.9" min="0" name="lengthCm" step="0.1" type="number" />
                <b>cm</b>
              </span>
            </label>
            <label>
              重さ
              <span class="unit-input">
                <input max="999999" min="0" name="weightG" type="number" />
                <b>g</b>
              </span>
            </label>
          </div>
          <div class="field-pair">
            <label>
              釣り方
              <input maxlength={48} name="method" placeholder="ルアー / サビキ / フライ" />
            </label>
            <label>
              ルアー・餌
              <input maxlength={80} name="lure" placeholder="ミノー 90mm / アオイソメ" />
            </label>
          </div>
          <div class="field-pair">
            <label>
              レンジ・水深
              <input maxlength={40} name="depth" placeholder="表層 / 底から1m" />
            </label>
            <label>
              その後
              <select name="disposition" required>
                <option value="released">リリース</option>
                <option value="kept">持ち帰り</option>
                <option value="lost">バラシ・観察</option>
              </select>
            </label>
          </div>
          <label>
            メモ
            <textarea
              maxlength={500}
              name="note"
              placeholder="当たり方、回収速度、魚の状態"
            ></textarea>
          </label>
          <label class="photo-drop">
            <input
              accept="image/jpeg,image/png,image/webp"
              data-photo-input
              name="photo"
              type="file"
            />
            <span class="photo-icon">◫</span>
            <strong data-photo-label>写真を1枚添える</strong>
            <small>端末内でJPEG・220KB以下へ縮小。EXIFは保持しません。</small>
          </label>
          <button class="primary-button" type="submit">
            魚影を置く
          </button>
          <p class="form-state" data-catch-state></p>
        </form>
      </dialog>

      <template id="trip-tab-template">
        <button class="trip-tab" type="button">
          <span class="tab-float" aria-hidden="true"></span>
          <span data-tab-name></span>
          <small data-tab-date></small>
        </button>
      </template>

      <template id="catch-template">
        <article class="catch-tag">
          <div class="catch-time">
            <time data-catch-time></time>
            <span data-catch-disposition-label></span>
          </div>
          <figure data-catch-photo-wrap hidden>
            <img alt="" data-catch-photo />
          </figure>
          <div class="catch-main">
            <div class="catch-title">
              <h3 data-catch-species></h3>
              <span data-catch-count-label></span>
            </div>
            <div class="catch-measures">
              <strong data-catch-length></strong>
              <span data-catch-weight></span>
            </div>
            <p data-catch-method></p>
            <p data-catch-note></p>
          </div>
          <div class="card-actions">
            <button data-catch-action="share" type="button">
              位置なし共有札
            </button>
            <button data-catch-action="delete" type="button">
              削除
            </button>
          </div>
        </article>
      </template>
    </main>
  </Layout>
);

const GuidePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/guide`}
    description="釣果灯で釣行と釣果を端末内に残し、位置情報を含まない共有札を作る4つの手順。"
    title="使い方｜釣果灯"
  >
    <main class="info-page" id="main">
      <div class="info-heading">
        <div class="guide-float" aria-hidden="true">
          <i></i>
          <span></span>
        </div>
        <div>
          <p class="eyebrow">FOUR CASTS</p>
          <h1>水辺の記録を重ねる</h1>
        </div>
      </div>
      <ol class="guide-steps">
        <li>
          <span class="step-visual water-card" aria-hidden="true">
            <i></i>
            <b></b>
          </span>
          <div>
            <strong>1</strong>
            <h2>釣行を置く</h2>
            <p>日付、水辺、時間と自分だけの場所メモを端末内へ残します。</p>
          </div>
        </li>
        <li>
          <span class="step-visual fish-card" aria-hidden="true">
            <i></i>
            <b></b>
          </span>
          <div>
            <strong>2</strong>
            <h2>一匹ずつ魚影を置く</h2>
            <p>魚種、時刻、サイズ、仕掛け、任意の写真を一枚の釣果札にします。</p>
          </div>
        </li>
        <li>
          <span class="step-visual ripple-card" aria-hidden="true">
            <i></i>
            <b></b>
          </span>
          <div>
            <strong>3</strong>
            <h2>自分の波を見る</h2>
            <p>釣れた時間、魚種、月ごとの釣行を、魚影と波紋で振り返ります。</p>
          </div>
        </li>
        <li>
          <span class="step-visual carry-card" aria-hidden="true">
            <i></i>
            <b></b>
          </span>
          <div>
            <strong>4</strong>
            <h2>必要な分だけ持ち出す</h2>
            <p>位置なし共有札、PDF、CSV、写真込み編集ファイルを自分で書き出します。</p>
          </div>
        </li>
      </ol>
      <section class="safety-card">
        <span class="safety-ring"></span>
        <div>
          <h2>水辺の安全情報を提供するサービスではありません</h2>
          <p>
            天候、潮位、立入可否、遊漁規則、禁漁期間、ライフジャケット、帰港判断は、現地の掲示、公的情報、漁協、船宿、海上保安庁などで必ず確認してください。
          </p>
        </div>
      </section>
    </main>
  </Layout>
);

const PrivacyPage = () => (
  <Layout
    canonical={`${canonicalOrigin}/privacy`}
    description="釣果灯の釣行、釣果、場所メモ、写真、匿名計測の保存先と削除方法。"
    title="保存先｜釣果灯"
  >
    <main class="info-page" id="main">
      <div class="info-heading">
        <div class="storage-tackle" aria-hidden="true">
          <span>LOCAL</span>
          <i></i>
        </div>
        <div>
          <p class="eyebrow">KEPT CLOSE</p>
          <h1>釣り場は、この端末の中へ</h1>
        </div>
      </div>
      <div class="privacy-flow">
        <div>
          <span class="flow-fish">◖</span>
          <strong>釣行・釣果・場所・写真</strong>
        </div>
        <span class="flow-arrow">→</span>
        <div class="browser-box">
          <span>このブラウザ</span>
          <strong>IndexedDB</strong>
        </div>
        <span class="flow-stop">×</span>
        <div>
          <span class="flow-cloud">☁</span>
          <strong>内容APIなし</strong>
        </div>
      </div>
      <section class="privacy-copy">
        <article>
          <h2>GPSを要求しない</h2>
          <p>
            位置情報APIは使いません。任意の場所メモ、釣行、釣果、仕掛け、写真はIndexedDBだけに保存します。写真はJPEGへ再圧縮し、元画像のEXIFは保持しません。
          </p>
        </article>
        <article>
          <h2>匿名の操作計測</h2>
          <p>
            サーバーへ届くのは、許可済み操作名、ランダムなブラウザID、JST日付、QAフラグだけです。魚種、場所、写真、仕掛け、サイズ、件数は含めず、45日で削除します。
          </p>
        </article>
        <article>
          <h2>共有札に場所を入れない</h2>
          <p>
            共有札には魚種、日付、水辺の種類、サイズ、仕掛けだけを描きます。場所メモ、釣行メモ、写真、正確な時刻は含めません。生成後の共有先は利用者が決めます。
          </p>
        </article>
        <article>
          <h2>削除とバックアップ</h2>
          <p>
            「すべての記録を消す」またはブラウザのサイトデータ削除で内容を消せます。復元には事前に書き出した`.chokato`ファイルが必要です。
          </p>
        </article>
      </section>
    </main>
  </Layout>
);

app.use("*", requestId());
app.use("*", securityHeaders);

app.get("/", (c) => {
  c.header("Cache-Control", "no-store");
  return c.html(<HomePage />);
});
app.get("/guide", (c) => c.html(<GuidePage />));
app.get("/privacy", (c) => c.html(<PrivacyPage />));

app.post("/api/events", async (c) => {
  c.header("Cache-Control", "no-store");
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return c.json({ error: "cross_site_request" }, 403);
  }
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: "cross_site_request" }, 403);
  }
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return c.json({ error: "unsupported_media_type" }, 415);
  }
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > 1024) return c.json({ error: "payload_too_large" }, 413);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > 1024) {
    return c.json({ error: "payload_too_large" }, 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return c.json({ error: "invalid_event" }, 400);
  }
  const { name } = payload as Record<string, unknown>;
  const sessionId = c.req.header("x-choka-session") ?? "";
  if (
    typeof name !== "string" ||
    !eventNames.has(name) ||
    !sessionPattern.test(sessionId) ||
    Object.keys(payload).some((key) => key !== "name")
  ) {
    return c.json({ error: "invalid_event" }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO product_events (name, session_id, day, created_at, is_qa)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      name,
      sessionId.toLowerCase(),
      jstDay(),
      nowSeconds(),
      c.req.header("x-choka-qa") === "1" ? 1 : 0,
    )
    .run();
  return c.json({ accepted: true }, 202);
});

app.get("/health", (c) => c.json({ ok: true }));

app.notFound((c) => {
  if (c.req.path.startsWith("/api/") || !/\.[a-z0-9]{2,8}$/iu.test(c.req.path)) {
    return c.html(
      <Layout
        canonical={`${canonicalOrigin}/`}
        description="指定されたページは見つかりませんでした。"
        title="見つかりません｜釣果灯"
      >
        <main class="not-found" id="main">
          <span class="lost-float"></span>
          <h1>この水面には、まだ記録がありません。</h1>
          <a href="/">記録盤へ戻る</a>
        </main>
      </Layout>,
      404,
    );
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_event, env) => {
  await env.DB.prepare("DELETE FROM product_events WHERE created_at <= ?")
    .bind(nowSeconds() - eventLifetime)
    .run();
};

export { app, scheduled };

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;
