const CSV_FILE = "mirine_list.csv";

const COVER_VIDEO_DETAILS = new Set(["歌ってみた"]);
const COVER_SHORT_DETAILS = new Set([
  "歌みたショート",
  "歌みた切り抜き",
  "アカペラ版",
  "アカペラ",
  "新作ショート",
]);

const state = {
  rows: [],
  filteredRows: [],
  formats: [],
  detailsByFormat: new Map(),
  selectedDetailKeys: new Set(),
  selectedArtists: new Set(),
  indexMode: "song",
  showIndexTypeIcons: false,
  streamOrder: "newest",
  coverOrder: "newest",
  coverFilters: {
    full: false,
    short: false,
    includeRelated: false,
  },
  statsAnimated: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.replace(/\r$/, ""));
  if (row.some((cell) => cell !== "")) rows.push(row);

  const headers = rows.shift().map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/, "").trim() : header.trim()
  );

  return rows.map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = (cells[index] ?? "").trim();
    });
    return item;
  });
}

function timeToSeconds(value) {
  if (!value || value === "0") return 0;
  const parts = String(value).split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function buildListenUrl(row) {
  const url = row.URL || "";
  const seconds = timeToSeconds(row["開始時間"]);
  if (!url || seconds <= 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${seconds}s`;
}

function splitFeatureTags(value) {
  return [...new Set(
    String(value || "")
      .split("/")
      .map((tag) => tag.trim())
      .filter(Boolean)
  )];
}

function getCommonFeatureTags(rows) {
  if (!rows.length) return [];
  const [first, ...rest] = rows;
  return first.featureTags.filter((tag) =>
    rest.every((row) => row.featureTags.includes(tag))
  );
}

function renderFeatureTags(tags, className = "") {
  if (!tags.length) return "";
  const extraClass = className ? ` ${className}` : "";
  return `<div class="feature-tag-row${extraClass}">${tags
    .map((tag) => `<span class="feature-tag">${escapeHtml(tag)}</span>`)
    .join("")}</div>`;
}

function normalizeRow(row) {
  return {
    ...row,
    listenUrl: buildListenUrl(row),
    sortKey: row["ソートキー"] || "99999999-9-999",
    format: row["YouTube形式"] || "未分類",
    detail: row["詳細区分"] || "未分類",
    featureTags: splitFeatureTags(row["特徴タグ"]),
    channel: row["掲載ch"] || "",
    order: Number(row["曲順"] || 0),
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function splitSlashValues(value) {
  return String(value || "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getArtistEntries(row) {
  const searchNames = splitSlashValues(row["検索用アーティスト名"]);
  const displayName = String(row["アーティスト名"] || "").trim();
  const names = searchNames.length ? searchNames : [displayName || "未入力"];
  const readings = splitSlashValues(row["検索用アーティスト名よみ"]);

  const seen = new Set();
  return names
    .map((name, index) => ({
      name,
      reading: readings[index] || name,
    }))
    .filter((entry) => {
      if (seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    });
}

function getArtistNames(row) {
  return getArtistEntries(row).map((entry) => entry.name);
}

function compareArtistEntries(a, b) {
  const aName = String(a.name ?? a.artist ?? "");
  const bName = String(b.name ?? b.artist ?? "");
  const aReading = String(a.reading || aName);
  const bReading = String(b.reading || bName);

  const readingCompare = aReading.localeCompare(bReading, "ja", {
    sensitivity: "base",
    numeric: true,
  });

  return readingCompare || aName.localeCompare(bName, "ja", {
    sensitivity: "base",
    numeric: true,
  });
}

function getAllArtistEntries(rows) {
  const artistMap = new Map();
  rows.forEach((row) => {
    getArtistEntries(row).forEach((entry) => {
      const current = artistMap.get(entry.name);
      const hasExplicitReading = entry.reading !== entry.name;
      if (!current || (hasExplicitReading && current.reading === current.name)) {
        artistMap.set(entry.name, entry);
      }
    });
  });
  return [...artistMap.values()].sort(compareArtistEntries);
}

function getAllArtistNames(rows) {
  return getAllArtistEntries(rows).map((entry) => entry.name);
}

function sortRows(rows) {
  return [...rows].sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"));
}

function countUnique(rows, key) {
  return new Set(rows.map((row) => row[key]).filter(Boolean)).size;
}

function countUniqueBy(rows, keyFn) {
  return new Set(rows.map(keyFn).filter(Boolean)).size;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function matchesKeyword(row, keyword) {
  if (!keyword) return true;
  const target = [
    row["曲名"],
    row["アーティスト名"],
    row["検索用アーティスト名"],
    row["検索用アーティスト名よみ"],
    row["配信タイトル"],
    row["コラボ"],
    row["掲載ch"],
    row["備考"],
    row["詳細区分"],
    row["YouTube形式"],
  ]
    .join(" ")
    .toLowerCase();
  return target.includes(keyword.toLowerCase());
}

function animateStatNumbers() {
  if (state.statsAnimated) return;
  state.statsAnimated = true;

  const numberElements = $$("#stats .stat-number");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  numberElements.forEach((element) => {
    const target = Number(element.dataset.target || 0);
    element.textContent = prefersReducedMotion ? target.toLocaleString("ja-JP") : "0";
  });

  if (prefersReducedMotion) return;

  const duration = 900;
  const startTime = performance.now();

  function update(currentTime) {
    const progress = Math.min((currentTime - startTime) / duration, 1);
    const easedProgress = 1 - Math.pow(1 - progress, 3);

    numberElements.forEach((element) => {
      const target = Number(element.dataset.target || 0);
      const current = Math.round(target * easedProgress);
      element.textContent = current.toLocaleString("ja-JP");
    });

    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

function renderDataThroughDate() {
  const latestDate = state.rows
    .map((row) => String(row["日付"] || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a, "ja"))[0];

  const dateElement = $("#data-through-date");
  if (!dateElement || !latestDate) return;

  dateElement.textContent = latestDate;
  dateElement.hidden = false;
}




function makeFilterKey(format, detail) {
  return `${format}\u0000${detail}`;
}

function getFormatOrder(format) {
  const preferred = ["Live Stream", "Shorts", "Video"];
  const index = preferred.indexOf(format);
  return index === -1 ? preferred.length : index;
}

function renderFilters() {
  state.formats = uniqueSorted(state.rows.map((row) => row.format))
    .sort((a, b) => getFormatOrder(a) - getFormatOrder(b) || a.localeCompare(b, "ja"));

  state.detailsByFormat = new Map(
    state.formats.map((format) => [
      format,
      uniqueSorted(
        state.rows
          .filter((row) => row.format === format)
          .map((row) => row.detail)
      ),
    ])
  );
  state.selectedDetailKeys.clear();

  const formatLabels = {
    "Live Stream": "Live Stream / 配信",
    "Shorts": "Shorts / ショート",
    "Video": "Video / 動画",
  };

  $("#hierarchical-filters").innerHTML = state.formats.map((format, formatIndex) => {
    const details = state.detailsByFormat.get(format) || [];
    const formatLabel = formatLabels[format] || format;
    const parentId = `format-parent-${formatIndex}`;
    const children = details.map((detail, detailIndex) => {
      const childId = `format-detail-${formatIndex}-${detailIndex}`;
      return `
        <label class="chip hierarchy-child" for="${childId}">
          <input id="${childId}" type="checkbox" data-filter-child data-format="${escapeHtml(format)}" value="${escapeHtml(detail)}">
          <span>${escapeHtml(detail)}</span>
        </label>
      `;
    }).join("");

    return `
      <div class="hierarchy-row" data-filter-row="${escapeHtml(format)}">
        <div class="hierarchy-parent-cell">
          <label class="hierarchy-parent" for="${parentId}">
            <input id="${parentId}" type="checkbox" data-filter-parent value="${escapeHtml(format)}">
            <span>${escapeHtml(formatLabel)}</span>
          </label>
        </div>
        <div class="hierarchy-children-cell">${children}</div>
      </div>
    `;
  }).join("");

  $$('[data-filter-parent]').forEach((parent) => {
    parent.addEventListener("change", () => {
      const format = parent.value;
      const children = $$(`[data-filter-child][data-format="${CSS.escape(format)}"]`);
      children.forEach((child) => {
        child.checked = parent.checked;
        const key = makeFilterKey(format, child.value);
        if (parent.checked) state.selectedDetailKeys.add(key);
        else state.selectedDetailKeys.delete(key);
      });
      parent.indeterminate = false;
      renderList();
    });
  });

  $$('[data-filter-child]').forEach((child) => {
    child.addEventListener("change", () => {
      const key = makeFilterKey(child.dataset.format, child.value);
      if (child.checked) state.selectedDetailKeys.add(key);
      else state.selectedDetailKeys.delete(key);
      updateParentCheckbox(child.dataset.format);
      renderList();
    });
  });
}

function updateParentCheckbox(format) {
  const parent = $(`[data-filter-parent][value="${CSS.escape(format)}"]`);
  const children = $$(`[data-filter-child][data-format="${CSS.escape(format)}"]`);
  if (!parent || !children.length) return;
  const checkedCount = children.filter((child) => child.checked).length;
  parent.checked = checkedCount === children.length;
  parent.indeterminate = checkedCount > 0 && checkedCount < children.length;
}

function clearHierarchicalFilters() {
  state.selectedDetailKeys.clear();
  $$('[data-filter-child], [data-filter-parent]').forEach((input) => {
    input.checked = false;
    input.indeterminate = false;
  });
  renderList();
}

function renderBadgeSpans(row) {
  const badges = [row.format, row.detail].filter(Boolean);
  return badges.map((badge, index) => `<span class="badge ${index ? "sub" : ""}">${escapeHtml(badge)}</span>`).join("");
}

function renderBadges(row) {
  return `<div class="badge-row">${renderBadgeSpans(row)}</div>`;
}

function renderListenLink(row, label = "聴く") {
  if (!row.listenUrl) return "";
  return `<a class="listen-link" href="${escapeHtml(row.listenUrl)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

function renderList() {
  const keyword = $("#keyword").value.trim();
  const filterActive = state.selectedDetailKeys.size > 0;
  const rows = sortRows(state.rows).filter((row) => {
    const matchesSelection = !filterActive || state.selectedDetailKeys.has(makeFilterKey(row.format, row.detail));
    return matchesSelection && matchesKeyword(row, keyword);
  });
  state.filteredRows = rows;

  $("#list-count").textContent = `${rows.length}件表示`;

  if (!rows.length) {
    $("#song-table-body").innerHTML = `<tr><td colspan="10"><div class="empty">条件に合う歌唱がありません。</div></td></tr>`;
    return;
  }

  $("#song-table-body").innerHTML = rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row["日付"])}</td>
      <td>${escapeHtml(row.format)}</td>
      <td>${escapeHtml(row.detail)}</td>
      <td>
        <span class="song-title">${escapeHtml(row["曲名"])}</span>
        ${row["備考"] ? `<span class="subtext">${escapeHtml(row["備考"])}</span>` : ""}
      </td>
      <td>${escapeHtml(row["アーティスト名"])}</td>
      <td>${escapeHtml(row["コラボ"]) || ""}</td>
      <td>${escapeHtml(row.channel) || ""}</td>
      <td>${escapeHtml(row["配信タイトル"])}</td>
      <td>${renderListenLink(row)}</td>
    </tr>
  `).join("");
}

function isFullCoverRow(row) {
  return row.format === "Video" && COVER_VIDEO_DETAILS.has(row.detail);
}

function isShortCoverRow(row) {
  return row.format === "Shorts";
}

function isCoverRow(row) {
  return isFullCoverRow(row) || isShortCoverRow(row);
}

function isSelectedCoverKind(row) {
  const noKindSelected = !state.coverFilters.full && !state.coverFilters.short;
  if (noKindSelected) return isCoverRow(row);
  if (isFullCoverRow(row)) return state.coverFilters.full;
  if (isShortCoverRow(row)) return state.coverFilters.short;
  return false;
}

function coverKindLabel(row) {
  if (isFullCoverRow(row)) return "歌みたフル";
  if (isShortCoverRow(row)) return "歌Short";
  return "歌ってみた";
}

function coverTypeOrder(row) {
  if (row.format === "Video") return 1;
  if (row.format === "Shorts") return 2;
  return 9;
}

function makeCoverGroupId(row, rowById) {
  const visited = new Set();
  let current = row;

  while (current && current["関連元"] && !visited.has(current["歌唱ID"])) {
    visited.add(current["歌唱ID"]);
    const parent = rowById.get(current["関連元"]);
    if (!parent || !isCoverRow(parent)) return current["関連元"];
    current = parent;
  }

  return current?.["歌唱ID"] || row["関連元"] || row["歌唱ID"] || row["動画ID"] || row.URL;
}


function makeSongKey(row) {
  const song = String(row["曲名"] || "").trim();
  const artist = String(row["アーティスト名"] || "").trim();
  return `${song}\u0000${artist}`;
}

const INDEX_SECTION_ORDER = [
  "あ行",
  "か行",
  "さ行",
  "た行",
  "な行",
  "は行",
  "ま行",
  "や行",
  "ら行",
  "わ行",
  "A–Z",
  "数字・記号",
  "その他",
];

function katakanaToHiragana(value) {
  return String(value || "").replace(/[ァ-ヶ]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
}

function normalizeKanaInitial(value) {
  const text = katakanaToHiragana(String(value || "").trim());
  if (!text) return "";

  const first = [...text.normalize("NFD")][0] || "";
  const smallKanaMap = {
    "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お",
    "ゃ": "や", "ゅ": "ゆ", "ょ": "よ", "っ": "つ", "ゎ": "わ",
  };
  return smallKanaMap[first] || first;
}

function getSongSortText(row) {
  return String(row["曲名よみ"] || row["曲名"] || "").trim();
}

function getIndexSection(row) {
  const sortText = getSongSortText(row);
  if (!sortText) return "その他";

  const first = [...sortText][0];
  if (/[A-Za-z]/.test(first)) return "A–Z";
  if (/[0-9]/.test(first)) return "数字・記号";

  const kana = normalizeKanaInitial(sortText);
  if ("あいうえお".includes(kana)) return "あ行";
  if ("かきくけこ".includes(kana)) return "か行";
  if ("さしすせそ".includes(kana)) return "さ行";
  if ("たちつてと".includes(kana)) return "た行";
  if ("なにぬねの".includes(kana)) return "な行";
  if ("はひふへほ".includes(kana)) return "は行";
  if ("まみむめも".includes(kana)) return "ま行";
  if ("やゆよ".includes(kana)) return "や行";
  if ("らりるれろ".includes(kana)) return "ら行";
  if ("わをん".includes(kana)) return "わ行";

  if (/^[^\p{L}\p{N}]/u.test(first)) return "数字・記号";
  return "その他";
}

function compareSongIndexEntries(a, b) {
  const aText = getSongSortText(a.rows[0]);
  const bText = getSongSortText(b.rows[0]);
  const readingCompare = aText.localeCompare(bText, "ja", {
    sensitivity: "base",
    numeric: true,
  });
  if (readingCompare) return readingCompare;

  const songCompare = a.song.localeCompare(b.song, "ja", {
    sensitivity: "base",
    numeric: true,
  });
  return songCompare || a.artist.localeCompare(b.artist, "ja");
}

function renderIndexOccurrences(rows) {
  return `
    <div class="index-occurrences">
      ${sortRows(rows).map((row) => `
        <div class="index-occurrence">
          <span>${escapeHtml(row["日付"])}</span>
          <span>${escapeHtml(row.detail)}</span>
          ${row["配信タイトル"] ? `<span>${escapeHtml(row["配信タイトル"])}</span>` : ""}
          ${renderListenLink(row, "聴く")}
        </div>
      `).join("")}
    </div>
  `;
}

function renderIndexTypeIcons(rows) {
  if (!state.showIndexTypeIcons) return "";

  const icons = rows.map((row) => {
    if (row.format === "Live Stream") {
      return '<span class="index-type-icon" title="歌枠・配信" aria-label="歌枠・配信">🎤</span>';
    }
    if (row.format === "Video") {
      return '<span class="index-type-icon" title="歌ってみた動画" aria-label="歌ってみた動画">🎬</span>';
    }
    if (row.format === "Shorts") {
      return '<span class="index-type-icon" title="Shorts" aria-label="Shorts">📱</span>';
    }
    return '<span class="index-type-icon" title="その他" aria-label="その他">♪</span>';
  }).join("");

  return `<span class="index-type-icons">${icons}</span>`;
}

function renderIndexSongMode(rows) {
  const songGroups = [...groupBy(rows, makeSongKey).entries()]
    .map(([key, groupRows]) => ({
      key,
      rows: groupRows,
      song: groupRows[0]["曲名"] || "曲名未入力",
      artist: groupRows[0]["アーティスト名"] || "アーティスト名未入力",
    }))
    .sort(compareSongIndexEntries);

  const sections = groupBy(songGroups, (group) => getIndexSection(group.rows[0]));
  return INDEX_SECTION_ORDER
    .filter((sectionName) => sections.has(sectionName))
    .map((sectionName) => {
      const groups = sections.get(sectionName);
      return `
        <section class="index-section">
          <h3 class="index-section-title">${escapeHtml(sectionName)}</h3>
          <ul class="dense-index-list">
            ${groups.map((group) => `
              <li class="dense-index-item">
                <button class="index-entry-button" type="button" aria-expanded="false">
                  <span class="index-entry-main">
                    <span class="song-title">${escapeHtml(group.song)}</span>
                    <span class="index-separator"> / </span>
                    <span class="index-artist-credit">${escapeHtml(group.artist)}</span>
                  </span>
                  ${renderIndexTypeIcons(group.rows)}
                </button>
                <div class="index-entry-details" hidden>
                  ${renderIndexOccurrences(group.rows)}
                </div>
              </li>
            `).join("")}
          </ul>
        </section>
      `;
    }).join("");
}

function renderIndexArtistMode(rows) {
  const artistMap = new Map();
  rows.forEach((row) => {
    getArtistEntries(row).forEach(({ name, reading }) => {
      if (!artistMap.has(name)) artistMap.set(name, { reading, rows: [] });
      const group = artistMap.get(name);
      if (group.reading === name && reading !== name) group.reading = reading;
      group.rows.push(row);
    });
  });

  return [...artistMap.entries()]
    .map(([artist, group]) => ({ artist, reading: group.reading, artistRows: group.rows }))
    .sort(compareArtistEntries)
    .map(({ artist, artistRows }) => {
      const songs = [...groupBy(artistRows, makeSongKey).entries()]
        .map(([, groupRows]) => ({
          rows: groupRows,
          song: groupRows[0]["曲名"] || "曲名未入力",
          originalArtist: groupRows[0]["アーティスト名"] || "アーティスト名未入力",
        }))
        .sort((a, b) => {
          const aReading = getSongSortText(a.rows[0]);
          const bReading = getSongSortText(b.rows[0]);
          const readingCompare = aReading.localeCompare(bReading, "ja", {
            sensitivity: "base",
            numeric: true,
          });
          return readingCompare || a.song.localeCompare(b.song, "ja");
        });

      return `
        <section class="index-section artist-index-section">
          <h3 class="index-section-title">${escapeHtml(artist)}</h3>
          <ul class="dense-index-list">
            ${songs.map((song) => `
              <li class="dense-index-item">
                <button class="index-entry-button" type="button" aria-expanded="false">
                  <span class="index-entry-main">
                    <span class="song-title">${escapeHtml(song.song)}</span>
                    <span class="index-separator"> / </span>
                    <span class="index-artist-credit">${escapeHtml(song.originalArtist)}</span>
                  </span>
                  ${renderIndexTypeIcons(song.rows)}
                </button>
                <div class="index-entry-details" hidden>
                  ${renderIndexOccurrences(song.rows)}
                </div>
              </li>
            `).join("")}
          </ul>
        </section>
      `;
    }).join("");
}

function bindIndexEntries() {
  $$(".index-entry-button").forEach((button) => {
    button.addEventListener("click", () => {
      const details = button.nextElementSibling;
      const isOpen = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!isOpen));
      details.hidden = isOpen;
    });
  });
}

function renderSongIndex() {
  const keyword = $("#index-keyword").value.trim().toLowerCase();
  const rows = state.rows.filter((row) => {
    if (!keyword) return true;
    return [
      row["曲名"],
      row["曲名よみ"],
      row["アーティスト名"],
      row["検索用アーティスト名"],
      row["検索用アーティスト名よみ"],
    ].join(" ").toLowerCase().includes(keyword);
  });

  const uniqueSongCount = countUniqueBy(rows, makeSongKey);
  $("#index-count").textContent = `${uniqueSongCount}曲`;

  if (!rows.length) {
    $("#song-index").innerHTML = `<div class="empty">条件に合う曲がありません。</div>`;
    return;
  }

  $("#song-index").innerHTML = state.indexMode === "artist"
    ? renderIndexArtistMode(rows)
    : renderIndexSongMode(rows);
  bindIndexEntries();
}

function renderCovers() {
  const keyword = $("#cover-keyword").value.trim();
  const rowById = new Map(state.rows.map((row) => [row["歌唱ID"], row]));
  const allCoverRows = sortRows(state.rows).filter(isCoverRow);
  const allGroups = groupBy(allCoverRows, (row) => makeCoverGroupId(row, rowById));

  const targetRows = allCoverRows.filter((row) =>
    isSelectedCoverKind(row) && matchesKeyword(row, keyword)
  );
  const targetRowSet = new Set(targetRows);
  const selectedGroupIds = new Set(targetRows.map((row) => makeCoverGroupId(row, rowById)));

  const groups = [...selectedGroupIds]
    .map((groupId) => {
      const groupRows = allGroups.get(groupId) || [];
      const rows = state.coverFilters.includeRelated
        ? groupRows
        : groupRows.filter((row) => targetRows.includes(row));

      const sortedRows = [...rows].sort((a, b) =>
        coverTypeOrder(a) - coverTypeOrder(b) ||
        a.sortKey.localeCompare(b.sortKey, "ja") ||
        (a["歌唱ID"] || "").localeCompare(b["歌唱ID"] || "", "ja")
      );

      const parent = rowById.get(groupId);
      const representative = parent && isCoverRow(parent) ? parent : sortedRows[0];
      const targetGroupRows = groupRows.filter((row) => targetRowSet.has(row));
      const groupSortKey = parent && isCoverRow(parent)
        ? parent.sortKey
        : groupRows.reduce(
            (min, row) => row.sortKey < min ? row.sortKey : min,
            groupRows[0]?.sortKey || "99999999-9-999"
          );
      const hasFullCover = groupRows.some(isFullCoverRow);
      const targetIdSet = new Set(targetGroupRows.map((row) => row["歌唱ID"]));

      return { groupId, rows: sortedRows, representative, groupSortKey, hasFullCover, targetIdSet };
    })
    .filter((group) => group.rows.length)
    .sort((a, b) => {
      const comparison = a.groupSortKey.localeCompare(b.groupSortKey, "ja");
      return state.coverOrder === "newest" ? -comparison : comparison;
    });

  const visibleRowsCount = groups.reduce((total, group) => total + group.rows.length, 0);
  $("#cover-count").textContent = `${groups.length}曲 / ${visibleRowsCount}本`;

  if (!groups.length) {
    $("#cover-cards").innerHTML = `<div class="empty">条件に合う歌ってみたがありません。</div>`;
    return;
  }

  $("#cover-cards").innerHTML = groups.map(({ groupId, rows, representative, hasFullCover, targetIdSet }) => {
    const title = representative["曲名"] || rows[0]["曲名"] || "曲名未入力";
    const artist = representative["アーティスト名"] || rows[0]["アーティスト名"] || "";
    const cardClass = hasFullCover ? "has-full-cover" : "short-only-cover";

    return `
      <article class="card cover-card ${cardClass}" id="cover-${escapeHtml(groupId)}">
        <div class="card-header">
          <h3 class="card-title cover-card-title">
            <span>${escapeHtml(title)}</span>
            ${artist ? `<span class="cover-card-artist">／ ${escapeHtml(artist)}</span>` : ""}
          </h3>
        </div>
        <div class="card-body">
          <div class="cover-entry-list">
            ${rows.map((row) => {
              const isTarget = targetIdSet.has(row["歌唱ID"]);
              return `
                <div class="cover-entry ${isTarget ? "" : "related-entry"}">
                  <div class="cover-entry-main">
                    <div class="badge-row cover-entry-info">
                      <span class="cover-entry-date">${escapeHtml(row["日付"])}</span>
                      <span class="badge ${isFullCoverRow(row) ? "cover-full-badge" : "cover-short-badge"}">${escapeHtml(coverKindLabel(row))}</span>
                      ${isFullCoverRow(row) || !row.detail ? "" : `<span class="badge sub">${escapeHtml(row.detail)}</span>`}
                      ${isTarget ? "" : `<span class="badge related-badge">関連表示</span>`}
                    </div>
                    <div class="cover-entry-title">${escapeHtml(row["配信タイトル"] || row["曲名"])}</div>
                    ${row["備考"] ? `<span class="subtext">${escapeHtml(row["備考"])}</span>` : ""}
                  </div>
                  ${renderListenLink(row)}
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderStreams() {
  const keyword = $("#stream-keyword").value.trim();
  const streamRows = sortRows(state.rows)
    .filter((row) => row.format === "Live Stream")
    .filter((row) => matchesKeyword(row, keyword));

  const groups = [...groupBy(streamRows, (row) => row["動画ID"] || row.URL).entries()]
    .map(([videoId, rows]) => [videoId, rows.sort((a, b) => a.order - b.order)])
    .sort((a, b) => {
      const comparison = a[1][0].sortKey.localeCompare(b[1][0].sortKey, "ja");
      return state.streamOrder === "newest" ? -comparison : comparison;
    });

  $("#stream-count").textContent = `${groups.length}枠 / ${streamRows.length}曲`;

  if (!groups.length) {
    $("#stream-cards").innerHTML = `<div class="empty">条件に合う歌枠がありません。</div>`;
    return;
  }

  $("#stream-cards").innerHTML = groups.map(([videoId, rows]) => {
    const first = rows[0];
    const title = first["配信タイトル"];
    const additionalMeta = [
      first["コラボ"] ? `コラボ: ${first["コラボ"]}` : "",
      first.channel ? `掲載ch: ${first.channel}` : "",
    ].filter(Boolean);
    const commonFeatureTags = getCommonFeatureTags(rows);
    return `
      <article class="card stream-card" id="stream-${escapeHtml(videoId)}">
        <div class="card-header">
          <div class="badge-row stream-header-info">
            <span class="stream-header-date">${escapeHtml(first["日付"])}</span>
            <span class="badge sub">${escapeHtml(first.detail)}</span>
            ${commonFeatureTags
              .map((tag) => `<span class="feature-tag">${escapeHtml(tag)}</span>`)
              .join("")}
          </div>
          <h3 class="card-title">${escapeHtml(title)}</h3>
          ${additionalMeta.length ? `
            <div class="card-meta stream-additional-meta">
              ${additionalMeta.map((item, index) => `
                ${index ? `<span>／</span>` : ""}
                <span>${escapeHtml(item)}</span>
              `).join("")}
            </div>
          ` : ""}
        </div>
        <div class="card-body">
          <ul class="track-list">
            ${rows.map((row) => {
              const rowOnlyTags = row.featureTags.filter((tag) => !commonFeatureTags.includes(tag));
              return `
              <li class="track-item">
                <span class="track-number">${escapeHtml(row["曲順"] || "-")}</span>
                <span>
                  <span class="song-title">${escapeHtml(row["曲名"])}</span>
                  <span class="subtext">${escapeHtml(row["アーティスト名"])}${row["備考"] ? ` / ${escapeHtml(row["備考"])}` : ""}</span>
                  ${renderFeatureTags(rowOnlyTags, "track-feature-tags")}
                </span>
                ${renderListenLink(row)}
              </li>
            `;
            }).join("")}
          </ul>
          ${first.URL ? `<p><a class="jump-link" href="${escapeHtml(first.URL)}" target="_blank" rel="noopener">配信を見る</a></p>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderArtists() {
  const keyword = $("#artist-keyword").value.trim().toLowerCase();
  const artistMap = new Map();

  sortRows(state.rows).forEach((row) => {
    getArtistEntries(row).forEach(({ name, reading }) => {
      if (!artistMap.has(name)) artistMap.set(name, { reading, rows: [] });
      const group = artistMap.get(name);
      if (group.reading === name && reading !== name) group.reading = reading;
      group.rows.push(row);
    });
  });

  const artistGroups = [...artistMap.entries()]
    .map(([artist, group]) => ({ artist, reading: group.reading, rows: group.rows }))
    .filter((group) => {
      if (state.selectedArtists.size && !state.selectedArtists.has(group.artist)) return false;
      if (!keyword) return true;
      const target = [
        group.artist,
        group.reading,
        ...group.rows.flatMap((row) => [
          row["曲名"],
          row["アーティスト名"],
          row["検索用アーティスト名"],
          row["検索用アーティスト名よみ"],
        ]),
      ].join(" ").toLowerCase();
      return target.includes(keyword);
    })
    .sort(compareArtistEntries);

  $("#artist-count").textContent = state.selectedArtists.size
    ? `${artistGroups.length}アーティスト / ${state.selectedArtists.size}件選択中`
    : `${artistGroups.length}アーティスト`;

  const allArtists = getAllArtistNames(state.rows);
  $("#artist-index").innerHTML = `
    <button type="button" class="artist-index-button ${state.selectedArtists.size ? "" : "active"}" data-artist-filter="">全アーティスト表示</button>
    ${allArtists.map((artist) => `
      <button type="button" class="artist-index-button ${state.selectedArtists.has(artist) ? "active" : ""}" data-artist-filter="${escapeHtml(artist)}">${escapeHtml(artist)}</button>
    `).join("")}
  `;

  if (!artistGroups.length) {
    $("#artist-cards").innerHTML = `<div class="empty">条件に合うアーティストがありません。</div>`;
    bindArtistIndexButtons();
    return;
  }

  $("#artist-cards").innerHTML = artistGroups.map((group) => {
    const songGroups = [...groupBy(group.rows, (row) => row["曲名"] || "曲名未入力").entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ja"));

    return `
      <article class="card artist-card open" data-artist-card="${escapeHtml(group.artist)}">
        <div class="card-header" data-artist-toggle>
          <h3 class="card-title">
            <span>${escapeHtml(group.artist)}</span>
            <span class="artist-counts">${songGroups.length}曲</span>
          </h3>
        </div>
        <div class="card-body artist-details">
          <ul class="artist-song-list">
            ${songGroups.map(([songName, rows]) => {
              const originalArtistNames = uniqueSorted(
                rows.map((row) => String(row["アーティスト名"] || "").trim())
              );
              return `
              <li class="artist-song-item">
                <div class="artist-song-heading">
                  <span class="song-title">${escapeHtml(songName)}</span>
                  <span class="original-artist-name">${escapeHtml(originalArtistNames.join(" ／ ") || "アーティスト名未入力")}</span>
                </div>
                <div class="song-occurrences">
                  ${rows.map((row) => `
                    <div class="occurrence">
                      <span>${escapeHtml(row["日付"])}</span>
                      <span>${escapeHtml(row.detail)}</span>
                      ${row["配信タイトル"] ? `<span>${escapeHtml(row["配信タイトル"])}</span>` : ""}
                      ${renderListenLink(row, "聴く")}
                    </div>
                  `).join("")}
                </div>
              </li>
              `;
            }).join("")}
          </ul>
        </div>
      </article>
    `;
  }).join("");

  bindArtistIndexButtons();

  $$('[data-artist-toggle]').forEach((header) => {
    header.addEventListener("click", () => {
      header.closest(".artist-card").classList.toggle("open");
    });
  });
}

function bindArtistIndexButtons() {
  $$('[data-artist-filter]').forEach((button) => {
    button.addEventListener("click", () => {
      const artist = button.dataset.artistFilter || "";
      if (!artist) {
        state.selectedArtists.clear();
      } else if (state.selectedArtists.has(artist)) {
        state.selectedArtists.delete(artist);
      } else {
        state.selectedArtists.add(artist);
      }
      renderArtists();
      $("#tab-artists").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function activateTab(tabName, { scroll = true } = {}) {
  $$('.tab-button').forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
  history.replaceState(null, "", `#${tabName}`);

  if (scroll) {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }
}

function setupTabs() {
  $$('.tab-button').forEach((button) => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.tab);
    });
  });

  const initialTab = location.hash.replace("#", "");
  if (["list", "index", "covers", "streams", "artists"].includes(initialTab)) {
    activateTab(initialTab, { scroll: false });
  }
}

function setupEvents() {
  $("#keyword").addEventListener("input", renderList);
  $("#index-keyword").addEventListener("input", renderSongIndex);
  $$('[data-index-mode]').forEach((button) => {
    button.addEventListener("click", () => {
      state.indexMode = button.dataset.indexMode;
      $$('[data-index-mode]').forEach((item) => item.classList.toggle("active", item === button));
      renderSongIndex();
    });
  });
  $("#index-type-icons-toggle").addEventListener("change", (event) => {
    state.showIndexTypeIcons = event.target.checked;
    renderSongIndex();
  });
  $("#cover-keyword").addEventListener("input", renderCovers);
  $("#cover-full-filter").addEventListener("change", (event) => {
    state.coverFilters.full = event.target.checked;
    renderCovers();
  });
  $("#cover-short-filter").addEventListener("change", (event) => {
    state.coverFilters.short = event.target.checked;
    renderCovers();
  });
  $("#cover-related-toggle").addEventListener("change", (event) => {
    state.coverFilters.includeRelated = event.target.checked;
    renderCovers();
  });
  $$(`[data-cover-order]`).forEach((button) => {
    button.addEventListener("click", () => {
      state.coverOrder = button.dataset.coverOrder;
      $$(`[data-cover-order]`).forEach((item) => item.classList.toggle("active", item === button));
      renderCovers();
    });
  });
  $("#stream-keyword").addEventListener("input", renderStreams);
  $$(`[data-stream-order]`).forEach((button) => {
    button.addEventListener("click", () => {
      state.streamOrder = button.dataset.streamOrder;
      $$(`[data-stream-order]`).forEach((item) => item.classList.toggle("active", item === button));
      renderStreams();
    });
  });
  $("#artist-keyword").addEventListener("input", () => {
    state.selectedArtists.clear();
    renderArtists();
  });

  $("#reset-filters").addEventListener("click", () => {
    $("#keyword").value = "";
    clearHierarchicalFilters();
  });
}

async function init() {
  try {
    const response = await fetch(CSV_FILE, { cache: "no-store" });
    if (!response.ok) throw new Error(`${CSV_FILE} を読み込めませんでした。`);
    const text = await response.text();
    const rows = parseCSV(text)
      .map(normalizeRow)
      .filter((row) => row["曲名"] || row["配信タイトル"]);

    state.rows = sortRows(rows);
    renderDataThroughDate();

    renderFilters();
    renderList();
    renderSongIndex();
    renderCovers();
    renderStreams();
    renderArtists();
    setupEvents();
    setupTabs();
  } catch (error) {
    console.error(error);
    document.body.insertAdjacentHTML("afterbegin", `<div class="empty">CSVの読み込みでエラーが出ました: ${escapeHtml(error.message)}</div>`);
  }
}

init();
