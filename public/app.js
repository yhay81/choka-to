const databaseName = "choka-to";
const databaseVersion = 1;
const projectVersion = 1;
const maximumTrips = 100;
const maximumCatchesPerTrip = 100;
const maximumCatches = 500;
const maximumPhotos = 100;
const maximumPhotoBytes = 220 * 1024;
const activeTripKey = "choka-to-active-trip";
const sessionKey = "choka-to-session";
const visitKey = "choka-to-last-visit";
const automatedQa =
  new URLSearchParams(window.location.search).get("qa") === "1" || navigator.webdriver === true;

/** @type {IDBDatabase} */
let database;
/** @type {Array<Trip>} */
let trips = [];
/** @type {Array<CatchRecord>} */
let catches = [];
let activeTripId = "";
let pendingPhoto = null;
/** @type {Map<string, string>} */
const photoUrls = new Map();

/**
 * @typedef {Object} Trip
 * @property {string} id
 * @property {string} title
 * @property {string} date
 * @property {"sea"|"boat"|"river"|"lake"|"pond"|"other"} water
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {string} spotLabel
 * @property {string} condition
 * @property {string} tackle
 * @property {string} note
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} CatchRecord
 * @property {string} id
 * @property {string} tripId
 * @property {string} caughtAt
 * @property {string} species
 * @property {number} count
 * @property {number|null} lengthCm
 * @property {number|null} weightG
 * @property {string} method
 * @property {string} lure
 * @property {string} depth
 * @property {"released"|"kept"|"lost"} disposition
 * @property {string} note
 * @property {boolean} hasPhoto
 * @property {number} createdAt
 */

const elements = {
  emptyLog: document.querySelector("[data-empty-log]"),
  workspace: document.querySelector("[data-log-workspace]"),
  tripTabs: document.querySelector("[data-trip-tabs]"),
  tripTitle: document.querySelector("[data-trip-title]"),
  tripSummary: document.querySelector("[data-trip-summary]"),
  tripSpot: document.querySelector("[data-trip-spot]"),
  tripCondition: document.querySelector("[data-trip-condition]"),
  tripTackle: document.querySelector("[data-trip-tackle]"),
  tripNote: document.querySelector("[data-trip-note]"),
  catchTotal: document.querySelector("[data-catch-total]"),
  speciesTotal: document.querySelector("[data-species-total]"),
  bestLength: document.querySelector("[data-best-length]"),
  catchCount: document.querySelector("[data-catch-count]"),
  catchList: document.querySelector("[data-catch-list]"),
  catchEmpty: document.querySelector("[data-catch-empty]"),
  dispositionFilter: document.querySelector("[data-catch-disposition]"),
  searchFilter: document.querySelector("[data-catch-search]"),
  waterColumn: document.querySelector("[data-water-column]"),
  speciesChart: document.querySelector("[data-species-chart]"),
  monthChart: document.querySelector("[data-month-chart]"),
  tripDialog: document.querySelector("[data-trip-dialog]"),
  tripDialogKicker: document.querySelector("[data-trip-dialog-kicker]"),
  tripDialogTitle: document.querySelector("[data-trip-dialog-title]"),
  catchDialog: document.querySelector("[data-catch-dialog]"),
  importFile: document.querySelector("[data-import-file]"),
};

const text = (value, maximum = 600) =>
  String(value ?? "")
    .replaceAll("\u0000", "")
    .trim()
    .slice(0, maximum);

const finiteNumber = (value, minimum, maximum, fallback = null) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return fallback;
  return number;
};

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const isTime = (value) => value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hasOnlyKeys = (value, allowedKeys) =>
  Object.keys(value).length === allowedKeys.length &&
  Object.keys(value).every((key) => allowedKeys.includes(key));

const formatDate = (value) => {
  if (!isDate(value)) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T12:00:00`));
};

const waterLabels = {
  sea: "海・堤防",
  boat: "船",
  river: "川・渓流",
  lake: "湖",
  pond: "池・管理釣り場",
  other: "その他",
};

const dispositionLabels = {
  released: "リリース",
  kept: "持ち帰り",
  lost: "バラシ・観察",
};

const makeSessionId = () => crypto.randomUUID();
let sessionId = makeSessionId();
let lastVisit = "";
try {
  const storedSession = localStorage.getItem(sessionKey) ?? "";
  sessionId = isUuid(storedSession) ? storedSession : makeSessionId();
  localStorage.setItem(sessionKey, sessionId);
  lastVisit = localStorage.getItem(visitKey) ?? "";
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem(visitKey, today);
} catch {
  sessionId = makeSessionId();
}

const track = (name) => {
  if (automatedQa) return;
  void fetch("/api/events", {
    body: JSON.stringify({ name }),
    headers: {
      "content-type": "application/json",
      "x-choka-session": sessionId,
    },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
};

const openDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const nextDatabase = request.result;
      const tripStore = nextDatabase.createObjectStore("trips", { keyPath: "id" });
      tripStore.createIndex("date", "date");
      const catchStore = nextDatabase.createObjectStore("catches", { keyPath: "id" });
      catchStore.createIndex("tripId", "tripId");
      nextDatabase.createObjectStore("photos", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

const requestValue = (request) =>
  new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

const transactionDone = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("transaction_aborted"));
  });

const readAll = async (storeName) => {
  const transaction = database.transaction(storeName, "readonly");
  return requestValue(transaction.objectStore(storeName).getAll());
};

const putValue = async (storeName, value) => {
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
};

const getPhoto = async (id) => {
  const transaction = database.transaction("photos", "readonly");
  return requestValue(transaction.objectStore("photos").get(id));
};

const revokePhotoUrls = () => {
  for (const url of photoUrls.values()) URL.revokeObjectURL(url);
  photoUrls.clear();
};

const downloadBlob = (blob, fileName) => {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const csvCell = (value) => {
  let output = String(value ?? "");
  if (/^[=+\-@]/.test(output)) output = `'${output}`;
  return `"${output.replaceAll('"', '""')}"`;
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });

const dataUrlToBlob = async (value) => {
  if (!/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(value)) {
    throw new Error("写真形式が正しくありません。");
  }
  const bytes = Uint8Array.from(atob(value.slice(value.indexOf(",") + 1)), (character) =>
    character.charCodeAt(0),
  );
  const blob = new Blob([bytes], { type: "image/jpeg" });
  if (blob.type !== "image/jpeg" || blob.size > maximumPhotoBytes) {
    throw new Error("写真サイズが上限を超えています。");
  }
  return blob;
};

const canvasBlob = (canvas, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("画像を変換できませんでした。"))),
      "image/jpeg",
      quality,
    );
  });

const compressPhoto = async (file) => {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  ) {
    throw new Error("JPEG・PNG・WebPの20MB以下を選んでください。");
  }
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    let quality = 0.84;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("画像処理を開始できませんでした。");
      context.fillStyle = "#e9e3d5";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas, quality);
      if (blob.size <= maximumPhotoBytes) return blob;
      if (quality > 0.56) quality -= 0.1;
      else scale *= 0.78;
    }
  } finally {
    bitmap.close();
  }
  throw new Error("写真を220KB以下にできませんでした。別の写真を選んでください。");
};

const setFormState = (form, message, error = false) => {
  const state = form.querySelector(".form-state");
  if (!(state instanceof HTMLElement)) return;
  state.textContent = message;
  state.classList.toggle("error", error);
};

const activeTrip = () => trips.find((trip) => trip.id === activeTripId) ?? null;
const activeCatches = () => catches.filter((item) => item.tripId === activeTripId);

const sortTrips = () =>
  trips.sort(
    (left, right) => right.date.localeCompare(left.date) || right.createdAt - left.createdAt,
  );

const refreshData = async () => {
  trips = /** @type {Array<Trip>} */ (await readAll("trips"));
  catches = /** @type {Array<CatchRecord>} */ (await readAll("catches"));
  sortTrips();
  const preferred = localStorage.getItem(activeTripKey) ?? "";
  if (!trips.some((trip) => trip.id === activeTripId)) {
    activeTripId = trips.some((trip) => trip.id === preferred) ? preferred : (trips[0]?.id ?? "");
  }
};

const makeTrip = (formData) => {
  const now = Date.now();
  const id = text(formData.get("tripId"), 36);
  const date = text(formData.get("date"), 10);
  const water = text(formData.get("water"), 12);
  const startedAt = text(formData.get("startedAt"), 5);
  const endedAt = text(formData.get("endedAt"), 5);
  if (
    !isDate(date) ||
    !Object.hasOwn(waterLabels, water) ||
    !isTime(startedAt) ||
    !isTime(endedAt) ||
    (startedAt && endedAt && endedAt < startedAt)
  ) {
    throw new Error("日付・時間・水辺を確認してください。");
  }
  const existing = trips.find((trip) => trip.id === id);
  return {
    id: existing?.id ?? crypto.randomUUID(),
    title: text(formData.get("title"), 48),
    date,
    water,
    startedAt,
    endedAt,
    spotLabel: text(formData.get("spotLabel"), 64),
    condition: text(formData.get("condition"), 80),
    tackle: text(formData.get("tackle"), 120),
    note: text(formData.get("note"), 600),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
};

const makeCatch = (formData) => {
  const count = finiteNumber(formData.get("count"), 1, 999);
  const lengthCm = finiteNumber(formData.get("lengthCm"), 0, 999.9);
  const weightG = finiteNumber(formData.get("weightG"), 0, 999999);
  const caughtAt = text(formData.get("caughtAt"), 5);
  const disposition = text(formData.get("disposition"), 12);
  if (
    !activeTripId ||
    !count ||
    !isTime(caughtAt) ||
    !["released", "kept", "lost"].includes(disposition)
  ) {
    throw new Error("時刻、魚種、匹数、その後を確認してください。");
  }
  const species = text(formData.get("species"), 48);
  if (!species) throw new Error("魚種を入力してください。");
  return {
    id: crypto.randomUUID(),
    tripId: activeTripId,
    caughtAt,
    species,
    count,
    lengthCm,
    weightG,
    method: text(formData.get("method"), 48),
    lure: text(formData.get("lure"), 80),
    depth: text(formData.get("depth"), 40),
    disposition,
    note: text(formData.get("note"), 500),
    hasPhoto: Boolean(pendingPhoto),
    createdAt: Date.now(),
  };
};

const fillTripForm = (form, trip) => {
  const set = (name, value) => {
    const input = form.elements.namedItem(name);
    if (
      input instanceof HTMLInputElement ||
      input instanceof HTMLTextAreaElement ||
      input instanceof HTMLSelectElement
    ) {
      input.value = value;
    }
  };
  set("tripId", trip?.id ?? "");
  set("title", trip?.title ?? "");
  set("date", trip?.date ?? new Date().toISOString().slice(0, 10));
  set("water", trip?.water ?? "sea");
  set("startedAt", trip?.startedAt ?? "");
  set("endedAt", trip?.endedAt ?? "");
  set("spotLabel", trip?.spotLabel ?? "");
  set("condition", trip?.condition ?? "");
  set("tackle", trip?.tackle ?? "");
  set("note", trip?.note ?? "");
  const label = form.querySelector("[data-trip-submit-label]");
  if (label) label.textContent = trip ? "釣行を更新" : "水辺へ出る";
  setFormState(form, "");
};

const renderTripTabs = () => {
  if (!elements.tripTabs) return;
  elements.tripTabs.replaceChildren();
  const template = document.querySelector("#trip-tab-template");
  if (!(template instanceof HTMLTemplateElement)) return;
  for (const trip of trips) {
    const fragment = template.content.cloneNode(true);
    const button = fragment.querySelector(".trip-tab");
    if (!(button instanceof HTMLButtonElement)) continue;
    button.dataset.tripId = trip.id;
    button.classList.toggle("active", trip.id === activeTripId);
    button.setAttribute("aria-pressed", String(trip.id === activeTripId));
    const name = button.querySelector("[data-tab-name]");
    const date = button.querySelector("[data-tab-date]");
    if (name) name.textContent = trip.title;
    if (date) date.textContent = trip.date.slice(5).replace("-", ".");
    elements.tripTabs.append(fragment);
  }
};

const renderWaterColumn = (records) => {
  if (!elements.waterColumn) return;
  elements.waterColumn.replaceChildren();
  const visible = records.slice(0, 8);
  if (visible.length === 0) {
    const hint = document.createElement("span");
    hint.className = "water-column-hint";
    hint.textContent = "魚影はまだありません";
    elements.waterColumn.append(hint);
    return;
  }
  visible.forEach((record, index) => {
    const fish = document.createElement("span");
    const minute = record.caughtAt
      ? Number(record.caughtAt.slice(0, 2)) * 60 + Number(record.caughtAt.slice(3))
      : index * 90;
    const depth = Math.max(1, Math.min(5, Math.floor((minute / 1440) * 5) + 1));
    const size =
      record.lengthCm && record.lengthCm >= 50
        ? 3
        : record.lengthCm && record.lengthCm >= 25
          ? 2
          : 1;
    fish.className = `column-fish depth-${depth} size-${size} lane-${(index % 4) + 1}`;
    fish.setAttribute("aria-label", `${record.caughtAt} ${record.species}`);
    fish.title = `${record.caughtAt} ${record.species}`;
    elements.waterColumn.append(fish);
  });
};

const renderSpeciesChart = () => {
  if (!elements.speciesChart) return;
  const totals = new Map();
  for (const record of catches) {
    totals.set(record.species, (totals.get(record.species) ?? 0) + record.count);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  elements.speciesChart.replaceChildren();
  if (ranked.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "魚種を記録すると、全釣行の並びが見えます。";
    elements.speciesChart.append(empty);
    return;
  }
  const maximum = ranked[0]?.[1] ?? 1;
  for (const [species, count] of ranked) {
    const row = document.createElement("div");
    row.className = "species-row";
    const name = document.createElement("span");
    name.textContent = species;
    const bar = document.createElement("i");
    bar.className = `bar-${Math.max(1, Math.ceil((count / maximum) * 10))}`;
    const value = document.createElement("strong");
    value.textContent = `${count}匹`;
    row.append(name, bar, value);
    elements.speciesChart.append(row);
  }
};

const renderMonthChart = () => {
  if (!elements.monthChart) return;
  const now = new Date();
  const months = [];
  for (let index = 11; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    months.push({ key, label: `${date.getMonth() + 1}月`, count: 0 });
  }
  for (const trip of trips) {
    const month = months.find((item) => item.key === trip.date.slice(0, 7));
    if (month) month.count += 1;
  }
  const maximum = Math.max(1, ...months.map((item) => item.count));
  elements.monthChart.replaceChildren();
  for (const month of months) {
    const item = document.createElement("div");
    const level = month.count === 0 ? 0 : Math.max(1, Math.ceil((month.count / maximum) * 5));
    item.className = `month-wave level-${level}`;
    item.title = `${month.label} ${month.count}釣行`;
    const wave = document.createElement("i");
    const label = document.createElement("span");
    label.textContent = month.label;
    item.append(wave, label);
    elements.monthChart.append(item);
  }
};

const photoUrlFor = async (record) => {
  if (!record.hasPhoto) return "";
  const existing = photoUrls.get(record.id);
  if (existing) return existing;
  const photo = await getPhoto(record.id);
  if (!photo || !(photo.blob instanceof Blob)) return "";
  const url = URL.createObjectURL(photo.blob);
  photoUrls.set(record.id, url);
  return url;
};

const renderCatchList = async (records) => {
  if (!elements.catchList || !elements.catchEmpty) return;
  const disposition =
    elements.dispositionFilter instanceof HTMLSelectElement
      ? elements.dispositionFilter.value
      : "all";
  const query =
    elements.searchFilter instanceof HTMLInputElement
      ? elements.searchFilter.value.trim().toLocaleLowerCase("ja")
      : "";
  const visible = records
    .filter((record) => disposition === "all" || record.disposition === disposition)
    .filter((record) =>
      query
        ? [record.species, record.method, record.lure, record.depth, record.note]
            .join(" ")
            .toLocaleLowerCase("ja")
            .includes(query)
        : true,
    )
    .sort(
      (left, right) =>
        right.caughtAt.localeCompare(left.caughtAt) || right.createdAt - left.createdAt,
    );
  elements.catchList.replaceChildren();
  elements.catchEmpty.hidden = visible.length > 0;
  const template = document.querySelector("#catch-template");
  if (!(template instanceof HTMLTemplateElement)) return;
  for (const record of visible) {
    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector(".catch-tag");
    if (!(article instanceof HTMLElement)) continue;
    article.dataset.catchId = record.id;
    const set = (selector, value) => {
      const node = article.querySelector(selector);
      if (node) node.textContent = value;
    };
    set("[data-catch-time]", record.caughtAt || "時刻なし");
    set("[data-catch-disposition-label]", dispositionLabels[record.disposition]);
    set("[data-catch-species]", record.species);
    set("[data-catch-count-label]", `${record.count}匹`);
    set("[data-catch-length]", record.lengthCm === null ? "— cm" : `${record.lengthCm} cm`);
    set(
      "[data-catch-weight]",
      record.weightG === null ? "" : `${record.weightG.toLocaleString("ja-JP")} g`,
    );
    set(
      "[data-catch-method]",
      [record.method, record.lure, record.depth].filter(Boolean).join(" · ") || "仕掛けメモなし",
    );
    set("[data-catch-note]", record.note);
    const photoWrap = article.querySelector("[data-catch-photo-wrap]");
    const image = article.querySelector("[data-catch-photo]");
    if (photoWrap instanceof HTMLElement && image instanceof HTMLImageElement && record.hasPhoto) {
      const url = await photoUrlFor(record);
      if (url) {
        image.src = url;
        image.alt = `${record.species}の記録写真`;
        photoWrap.hidden = false;
      }
    }
    elements.catchList.append(fragment);
  }
};

const render = async () => {
  const hasTrips = trips.length > 0;
  if (elements.emptyLog instanceof HTMLElement) elements.emptyLog.hidden = hasTrips;
  if (elements.workspace instanceof HTMLElement) elements.workspace.hidden = !hasTrips;
  if (!hasTrips) {
    renderSpeciesChart();
    renderMonthChart();
    return;
  }
  renderTripTabs();
  const trip = activeTrip();
  if (!trip) return;
  const records = activeCatches();
  const total = records.reduce((sum, record) => sum + record.count, 0);
  const species = new Set(records.map((record) => record.species)).size;
  const best = records.reduce((maximum, record) => Math.max(maximum, record.lengthCm ?? 0), 0);
  if (elements.tripTitle) elements.tripTitle.textContent = trip.title;
  if (elements.tripSummary) {
    const hours =
      trip.startedAt && trip.endedAt
        ? `${trip.startedAt}–${trip.endedAt}`
        : trip.startedAt || trip.endedAt;
    elements.tripSummary.textContent = [formatDate(trip.date), waterLabels[trip.water], hours]
      .filter(Boolean)
      .join(" · ");
  }
  if (elements.tripSpot) elements.tripSpot.textContent = trip.spotLabel || "記録なし";
  if (elements.tripCondition) elements.tripCondition.textContent = trip.condition || "記録なし";
  if (elements.tripTackle) elements.tripTackle.textContent = trip.tackle || "記録なし";
  if (elements.tripNote)
    elements.tripNote.textContent = trip.note || "この日のメモはまだありません。";
  if (elements.catchTotal) elements.catchTotal.textContent = total.toLocaleString("ja-JP");
  if (elements.speciesTotal) elements.speciesTotal.textContent = species.toLocaleString("ja-JP");
  if (elements.bestLength) elements.bestLength.textContent = best > 0 ? String(best) : "—";
  if (elements.catchCount) elements.catchCount.textContent = `${records.length}件`;
  renderWaterColumn(records);
  await renderCatchList(records);
  renderSpeciesChart();
  renderMonthChart();
};

const saveTrip = async (form) => {
  try {
    const formData = new FormData(form);
    const isNew = !text(formData.get("tripId"), 36);
    const trip = makeTrip(formData);
    if (!trip.title) throw new Error("釣行の呼び名を入力してください。");
    if (!trips.some((item) => item.id === trip.id) && trips.length >= maximumTrips) {
      throw new Error(
        `釣行は${maximumTrips}件までです。書き出してから古い釣行を整理してください。`,
      );
    }
    await putValue("trips", trip);
    activeTripId = trip.id;
    localStorage.setItem(activeTripKey, trip.id);
    await refreshData();
    await render();
    setFormState(form, "保存しました。");
    if (isNew) track("trip_created");
    if (elements.tripDialog instanceof HTMLDialogElement && elements.tripDialog.open) {
      elements.tripDialog.close();
    }
  } catch (error) {
    setFormState(form, error instanceof Error ? error.message : "保存できませんでした。", true);
  }
};

const saveCatch = async (form) => {
  try {
    const records = activeCatches();
    if (records.length >= maximumCatchesPerTrip || catches.length >= maximumCatches) {
      throw new Error(`1釣行${maximumCatchesPerTrip}件、全体${maximumCatches}件まで記録できます。`);
    }
    if (pendingPhoto && catches.filter((record) => record.hasPhoto).length >= maximumPhotos) {
      throw new Error(`写真は全体で${maximumPhotos}枚までです。`);
    }
    const record = makeCatch(new FormData(form));
    const stores = pendingPhoto ? ["catches", "photos"] : ["catches"];
    const transaction = database.transaction(stores, "readwrite");
    transaction.objectStore("catches").put(record);
    if (pendingPhoto) transaction.objectStore("photos").put({ id: record.id, blob: pendingPhoto });
    await transactionDone(transaction);
    pendingPhoto = null;
    form.reset();
    const countInput = form.elements.namedItem("count");
    if (countInput instanceof HTMLInputElement) countInput.value = "1";
    await refreshData();
    await render();
    track("catch_added");
    if (elements.catchDialog instanceof HTMLDialogElement) elements.catchDialog.close();
  } catch (error) {
    setFormState(form, error instanceof Error ? error.message : "保存できませんでした。", true);
  }
};

const deleteCatch = async (record) => {
  if (!confirm(`${record.species}の記録を削除しますか？`)) return;
  const transaction = database.transaction(["catches", "photos"], "readwrite");
  transaction.objectStore("catches").delete(record.id);
  transaction.objectStore("photos").delete(record.id);
  await transactionDone(transaction);
  const url = photoUrls.get(record.id);
  if (url) URL.revokeObjectURL(url);
  photoUrls.delete(record.id);
  await refreshData();
  await render();
};

const deleteTrip = async () => {
  const trip = activeTrip();
  if (!trip || !confirm(`「${trip.title}」と、その釣果を削除しますか？`)) return;
  const related = catches.filter((record) => record.tripId === trip.id);
  const transaction = database.transaction(["trips", "catches", "photos"], "readwrite");
  transaction.objectStore("trips").delete(trip.id);
  for (const record of related) {
    transaction.objectStore("catches").delete(record.id);
    transaction.objectStore("photos").delete(record.id);
  }
  await transactionDone(transaction);
  revokePhotoUrls();
  activeTripId = "";
  await refreshData();
  await render();
};

const clearLog = async () => {
  if (!confirm("すべての釣行、釣果、写真をこの端末から削除しますか？")) return;
  const transaction = database.transaction(["trips", "catches", "photos"], "readwrite");
  transaction.objectStore("trips").clear();
  transaction.objectStore("catches").clear();
  transaction.objectStore("photos").clear();
  await transactionDone(transaction);
  revokePhotoUrls();
  activeTripId = "";
  localStorage.removeItem(activeTripKey);
  await refreshData();
  await render();
};

const exportCsv = () => {
  const header = [
    "釣行ID",
    "釣行名",
    "日付",
    "水辺",
    "開始",
    "終了",
    "場所メモ",
    "空と水",
    "タックル",
    "釣行メモ",
    "時刻",
    "魚種",
    "匹数",
    "長さcm",
    "重さg",
    "釣り方",
    "ルアー・餌",
    "レンジ・水深",
    "その後",
    "釣果メモ",
    "写真あり",
  ];
  const rows = [header.map(csvCell).join(",")];
  for (const trip of trips) {
    const related = catches.filter((record) => record.tripId === trip.id);
    const records = related.length ? related : [null];
    for (const record of records) {
      rows.push(
        [
          trip.id,
          trip.title,
          trip.date,
          waterLabels[trip.water],
          trip.startedAt,
          trip.endedAt,
          trip.spotLabel,
          trip.condition,
          trip.tackle,
          trip.note,
          record?.caughtAt ?? "",
          record?.species ?? "",
          record?.count ?? "",
          record?.lengthCm ?? "",
          record?.weightG ?? "",
          record?.method ?? "",
          record?.lure ?? "",
          record?.depth ?? "",
          record ? dispositionLabels[record.disposition] : "",
          record?.note ?? "",
          record?.hasPhoto ? "あり" : "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  downloadBlob(
    new Blob([`\uFEFF${rows.join("\r\n")}`], { type: "text/csv;charset=utf-8" }),
    `choka-to-${new Date().toISOString().slice(0, 10)}.csv`,
  );
};

const exportProject = async () => {
  const photos = [];
  for (const record of catches.filter((item) => item.hasPhoto)) {
    const photo = await getPhoto(record.id);
    if (photo?.blob instanceof Blob) {
      photos.push({ id: record.id, data: await blobToDataUrl(photo.blob) });
    }
  }
  const project = {
    format: "choka-to",
    version: projectVersion,
    exportedAt: new Date().toISOString(),
    trips,
    catches,
    photos,
  };
  downloadBlob(
    new Blob([JSON.stringify(project)], { type: "application/json" }),
    `choka-to-${new Date().toISOString().slice(0, 10)}.chokato`,
  );
  track("project_exported");
};

const tripKeys = [
  "id",
  "title",
  "date",
  "water",
  "startedAt",
  "endedAt",
  "spotLabel",
  "condition",
  "tackle",
  "note",
  "createdAt",
  "updatedAt",
];
const catchKeys = [
  "id",
  "tripId",
  "caughtAt",
  "species",
  "count",
  "lengthCm",
  "weightG",
  "method",
  "lure",
  "depth",
  "disposition",
  "note",
  "hasPhoto",
  "createdAt",
];
const projectKeys = ["format", "version", "exportedAt", "trips", "catches", "photos"];
const photoKeys = ["id", "data"];

const validImportedTrip = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const trip = value;
  return (
    hasOnlyKeys(trip, tripKeys) &&
    isUuid(trip.id) &&
    typeof trip.title === "string" &&
    trip.title.length >= 1 &&
    trip.title.length <= 48 &&
    isDate(trip.date) &&
    Object.hasOwn(waterLabels, trip.water) &&
    isTime(trip.startedAt) &&
    isTime(trip.endedAt) &&
    (!trip.startedAt || !trip.endedAt || trip.endedAt >= trip.startedAt) &&
    typeof trip.spotLabel === "string" &&
    trip.spotLabel.length <= 64 &&
    typeof trip.condition === "string" &&
    trip.condition.length <= 80 &&
    typeof trip.tackle === "string" &&
    trip.tackle.length <= 120 &&
    typeof trip.note === "string" &&
    trip.note.length <= 600 &&
    Number.isFinite(trip.createdAt) &&
    Number.isFinite(trip.updatedAt)
  );
};

const validImportedCatch = (value, tripIds) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value;
  return (
    hasOnlyKeys(record, catchKeys) &&
    isUuid(record.id) &&
    isUuid(record.tripId) &&
    tripIds.has(record.tripId) &&
    isTime(record.caughtAt) &&
    typeof record.species === "string" &&
    record.species.length >= 1 &&
    record.species.length <= 48 &&
    Number.isInteger(record.count) &&
    record.count >= 1 &&
    record.count <= 999 &&
    (record.lengthCm === null ||
      (Number.isFinite(record.lengthCm) && record.lengthCm >= 0 && record.lengthCm <= 999.9)) &&
    (record.weightG === null ||
      (Number.isFinite(record.weightG) && record.weightG >= 0 && record.weightG <= 999999)) &&
    typeof record.method === "string" &&
    record.method.length <= 48 &&
    typeof record.lure === "string" &&
    record.lure.length <= 80 &&
    typeof record.depth === "string" &&
    record.depth.length <= 40 &&
    ["released", "kept", "lost"].includes(record.disposition) &&
    typeof record.note === "string" &&
    record.note.length <= 500 &&
    typeof record.hasPhoto === "boolean" &&
    Number.isFinite(record.createdAt)
  );
};

const importProject = async (file) => {
  if (file.size > 40 * 1024 * 1024) throw new Error("読み込みファイルは40MB以下にしてください。");
  const project = JSON.parse(await file.text());
  if (
    !project ||
    typeof project !== "object" ||
    Array.isArray(project) ||
    !hasOnlyKeys(project, projectKeys) ||
    project.format !== "choka-to" ||
    project.version !== projectVersion ||
    typeof project.exportedAt !== "string" ||
    Number.isNaN(Date.parse(project.exportedAt)) ||
    !Array.isArray(project.trips) ||
    !Array.isArray(project.catches) ||
    !Array.isArray(project.photos) ||
    project.trips.length > maximumTrips ||
    project.catches.length > maximumCatches ||
    project.photos.length > maximumPhotos
  ) {
    throw new Error("釣果灯の編集用ファイルではないか、上限を超えています。");
  }
  if (!project.trips.every(validImportedTrip)) throw new Error("釣行データが正しくありません。");
  const tripIds = new Set(project.trips.map((trip) => trip.id));
  const catchIds = new Set(project.catches.map((record) => record.id));
  if (tripIds.size !== project.trips.length || catchIds.size !== project.catches.length) {
    throw new Error("重複したIDがあります。");
  }
  if (!project.catches.every((record) => validImportedCatch(record, tripIds))) {
    throw new Error("釣果データが正しくありません。");
  }
  for (const tripId of tripIds) {
    if (
      project.catches.filter((record) => record.tripId === tripId).length > maximumCatchesPerTrip
    ) {
      throw new Error(`1釣行あたり${maximumCatchesPerTrip}件を超えています。`);
    }
  }
  const photoIds = new Set();
  const photos = [];
  for (const photo of project.photos) {
    if (
      !photo ||
      typeof photo !== "object" ||
      Array.isArray(photo) ||
      !hasOnlyKeys(photo, photoKeys) ||
      !catchIds.has(photo.id) ||
      photoIds.has(photo.id) ||
      typeof photo.data !== "string"
    ) {
      throw new Error("写真データが正しくありません。");
    }
    photoIds.add(photo.id);
    photos.push({ id: photo.id, blob: await dataUrlToBlob(photo.data) });
  }
  if (
    project.catches.some(
      (record) =>
        (record.hasPhoto && !photoIds.has(record.id)) ||
        (!record.hasPhoto && photoIds.has(record.id)),
    )
  ) {
    throw new Error("釣果と写真の対応が正しくありません。");
  }
  if (!confirm("現在の記録を、読み込んだファイルの内容で置き換えますか？")) return;
  const transaction = database.transaction(["trips", "catches", "photos"], "readwrite");
  const tripStore = transaction.objectStore("trips");
  const catchStore = transaction.objectStore("catches");
  const photoStore = transaction.objectStore("photos");
  tripStore.clear();
  catchStore.clear();
  photoStore.clear();
  project.trips.forEach((trip) => tripStore.put(trip));
  project.catches.forEach((record) => catchStore.put(record));
  photos.forEach((photo) => photoStore.put(photo));
  await transactionDone(transaction);
  revokePhotoUrls();
  activeTripId = project.trips[0]?.id ?? "";
  await refreshData();
  await render();
  track("project_imported");
};

const roundedRectangle = (context, x, y, width, height, radius) => {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
};

const saveShareCard = async (record) => {
  const trip = trips.find((item) => item.id === record.tripId);
  if (!trip) return;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  context.fillStyle = "#061821";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = context.createLinearGradient(0, 0, 0, 630);
  gradient.addColorStop(0, "#1b6570");
  gradient.addColorStop(0.46, "#0a3c4a");
  gradient.addColorStop(1, "#061821");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(176, 223, 207, .34)";
  context.lineWidth = 5;
  for (let index = 0; index < 5; index += 1) {
    context.beginPath();
    context.ellipse(955, 100, 80 + index * 42, 18 + index * 9, 0, 0, Math.PI * 2);
    context.stroke();
  }
  context.fillStyle = "#d5f2e7";
  context.beginPath();
  context.moveTo(865, 300);
  context.quadraticCurveTo(960, 235, 1058, 306);
  context.quadraticCurveTo(958, 380, 865, 312);
  context.lineTo(804, 364);
  context.lineTo(821, 306);
  context.lineTo(804, 250);
  context.closePath();
  context.fill();
  context.fillStyle = "#e9e3d5";
  roundedRectangle(context, 72, 66, 630, 500, 34);
  context.fillStyle = "#0b3441";
  context.font = "700 28px system-ui, sans-serif";
  context.fillText("釣果灯 / 位置を含めない共有札", 118, 126);
  context.font = "800 78px system-ui, sans-serif";
  context.fillText(record.species.slice(0, 12), 112, 232);
  context.fillStyle = "#c45439";
  context.font = "800 48px system-ui, sans-serif";
  const measure = record.lengthCm === null ? `${record.count}匹` : `${record.lengthCm} cm`;
  context.fillText(measure, 114, 310);
  context.fillStyle = "#244a50";
  context.font = "600 28px system-ui, sans-serif";
  context.fillText(`${formatDate(trip.date)}  /  ${waterLabels[trip.water]}`, 114, 378);
  context.font = "500 25px system-ui, sans-serif";
  const tackle = [record.method, record.lure].filter(Boolean).join(" · ") || "仕掛けメモなし";
  context.fillText(tackle.slice(0, 32), 114, 430);
  context.fillStyle = "#708785";
  context.font = "500 21px system-ui, sans-serif";
  context.fillText("場所メモ・正確な時刻・写真は含めていません", 114, 510);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("共有札を作れませんでした。"))),
      "image/png",
    ),
  );
  downloadBlob(blob, `choka-to-${trip.date}-${record.species}.png`);
  track("share_card_saved");
};

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.matches("[data-trip-form]")) {
    event.preventDefault();
    void saveTrip(form);
  }
  if (form.matches("[data-catch-form]")) {
    event.preventDefault();
    void saveCatch(form);
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const tripTab = target.closest("[data-trip-id]");
  if (tripTab instanceof HTMLElement && tripTab.dataset.tripId) {
    activeTripId = tripTab.dataset.tripId;
    localStorage.setItem(activeTripKey, activeTripId);
    void render();
    return;
  }
  const catchAction = target.closest("[data-catch-action]");
  if (catchAction instanceof HTMLElement) {
    const article = catchAction.closest("[data-catch-id]");
    const record = catches.find((item) => item.id === article?.getAttribute("data-catch-id"));
    if (!record) return;
    if (catchAction.dataset.catchAction === "delete") void deleteCatch(record);
    if (catchAction.dataset.catchAction === "share") void saveShareCard(record);
    return;
  }
  const action = target.closest("[data-action]")?.getAttribute("data-action");
  if (!action) return;
  if (action === "add-trip" && elements.tripDialog instanceof HTMLDialogElement) {
    const form = elements.tripDialog.querySelector("[data-trip-form]");
    if (form instanceof HTMLFormElement) fillTripForm(form, null);
    if (elements.tripDialogTitle) elements.tripDialogTitle.textContent = "釣行を追加";
    if (elements.tripDialogKicker) elements.tripDialogKicker.textContent = "NEW WATER";
    elements.tripDialog.showModal();
  }
  if (action === "edit-trip" && elements.tripDialog instanceof HTMLDialogElement) {
    const form = elements.tripDialog.querySelector("[data-trip-form]");
    const trip = activeTrip();
    if (form instanceof HTMLFormElement && trip) fillTripForm(form, trip);
    if (elements.tripDialogTitle) elements.tripDialogTitle.textContent = "釣行を編集";
    if (elements.tripDialogKicker) elements.tripDialogKicker.textContent = "FIELD NOTE";
    elements.tripDialog.showModal();
  }
  if (action === "add-catch" && elements.catchDialog instanceof HTMLDialogElement) {
    const form = elements.catchDialog.querySelector("[data-catch-form]");
    if (form instanceof HTMLFormElement) {
      form.reset();
      const time = form.elements.namedItem("caughtAt");
      const count = form.elements.namedItem("count");
      if (time instanceof HTMLInputElement) {
        const now = new Date();
        time.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      }
      if (count instanceof HTMLInputElement) count.value = "1";
      setFormState(form, "");
    }
    pendingPhoto = null;
    const label = elements.catchDialog.querySelector("[data-photo-label]");
    if (label) label.textContent = "写真を1枚添える";
    elements.catchDialog.showModal();
  }
  if (action === "close-catch" && elements.catchDialog instanceof HTMLDialogElement) {
    elements.catchDialog.close();
  }
  if (action === "delete-catch") return;
  if (action === "delete-trip") void deleteTrip();
  if (action === "clear-log") void clearLog();
  if (action === "export-csv") exportCsv();
  if (action === "export-project") void exportProject();
  if (action === "print") {
    track("printed");
    window.print();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.matches("[data-photo-input]")) {
    const file = target.files?.[0];
    const form = target.closest("form");
    const label = form?.querySelector("[data-photo-label]");
    if (!file) {
      pendingPhoto = null;
      if (label) label.textContent = "写真を1枚添える";
      return;
    }
    void compressPhoto(file)
      .then((blob) => {
        pendingPhoto = blob;
        if (label) label.textContent = `${file.name} · ${Math.ceil(blob.size / 1024)}KB`;
        if (form instanceof HTMLFormElement) setFormState(form, "写真を端末内用に縮小しました。");
      })
      .catch((error) => {
        pendingPhoto = null;
        target.value = "";
        if (form instanceof HTMLFormElement) {
          setFormState(
            form,
            error instanceof Error ? error.message : "写真を処理できませんでした。",
            true,
          );
        }
      });
  }
  if (target === elements.dispositionFilter || target === elements.searchFilter) {
    void renderCatchList(activeCatches());
  }
  if (target === elements.importFile && target instanceof HTMLInputElement) {
    const file = target.files?.[0];
    target.value = "";
    if (file) {
      void importProject(file).catch((error) => {
        alert(error instanceof Error ? error.message : "読み込めませんでした。");
      });
    }
  }
});

elements.searchFilter?.addEventListener("input", () => void renderCatchList(activeCatches()));

window.addEventListener("beforeunload", revokePhotoUrls);

database = /** @type {IDBDatabase} */ (await openDatabase());
await refreshData();
const firstTripForm = document.querySelector("[data-empty-log] [data-trip-form]");
if (firstTripForm instanceof HTMLFormElement) fillTripForm(firstTripForm, null);
await render();
track("visited");
if (lastVisit && lastVisit !== new Date().toISOString().slice(0, 10)) track("returned");

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
