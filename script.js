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
  details: [],
  selectedFormats: new Set(),
  selectedDetails: new Set(),
  selectedArtist: "",
  coverFilters: {
    full: true,
    short: true,
    includeRelated: true,
  },
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

function normalizeRow(row) {
  return {
    ...row,
    listenUrl: buildListenUrl(row),
    sortKey: row["ソートキー"] || "99999999-9-999",
    format: row["YouTube形式"] || "未分類",
    detail: row["詳細区分"] || "未分類",
    channel: row["掲載ch"] || "",
    order: Number(row["曲順"] || 0),
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function getArtistNames(row) {
  const searchNames = String(row["検索用アーティスト名"] || "")
    .split("/")
    .map((name) => name.trim())
    .filter(Boolean);

  if (searchNames.length) return [...new Set(searchNames)];

  const displayName = String(row["アーティスト名"] || "").trim();
  return [displayName || "未入力"];
}

function getAllArtistNames(rows) {
  return uniqueSorted(rows.flatMap((row) => getArtistNames(row)));
}

function sortRows(rows) {
  return [...rows].sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"));
}

function countUnique(rows, key) {
  return new Set(rows.map((row) => row[key]).filter(Boolean)).size;
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

function renderStats() {
  const rows = state.rows;
  const stats = [
    [rows.length, "歌唱件数"],
    [countUnique(rows, "曲名"), "曲"],
    [getAllArtistNames(rows).length, "アーティスト"],
    [countUnique(rows.filter((row) => row.format === "Live Stream"), "動画ID"), "配信"],
  ];

  $("#stats").innerHTML = stats
    .map(([number, label]) => `
      <div class="stat-card">
        <span class="stat-number">${escapeHtml(number)}</span>
        <span class="stat-label">${escapeHtml(label)}</span>
      </div>
    `)
    .join("");
}

function makeFilterChip(groupName, value, index, checked = true) {
  const safeId = `${groupName}-${index}`;
  return `
    <label class="chip" for="${escapeHtml(safeId)}">
      <input id="${escapeHtml(safeId)}" type="checkbox" data-filter-group="${escapeHtml(groupName)}" value="${escapeHtml(value)}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(value)}</span>
    </label>
  `;
}

function renderFilters() {
  state.formats = uniqueSorted(state.rows.map((row) => row.format));
  state.details = uniqueSorted(state.rows.map((row) => row.detail));
  state.selectedFormats = new Set(state.formats);
  state.selectedDetails = new Set(state.details);

  $("#format-filters").innerHTML = state.formats.map((value, index) => makeFilterChip("format", value, index)).join("");
  $("#detail-filters").innerHTML = state.details.map((value, index) => makeFilterChip("detail", value, index)).join("");

  $$('[data-filter-group]').forEach((input) => {
    input.addEventListener("change", () => {
      const set = input.dataset.filterGroup === "format" ? state.selectedFormats : state.selectedDetails;
      if (input.checked) set.add(input.value);
      else set.delete(input.value);
      renderList();
    });
  });
}

function setFilterGroup(groupName, shouldSelect) {
  const set = groupName === "format" ? state.selectedFormats : state.selectedDetails;
  set.clear();

  $$(`[data-filter-group="${groupName}"]`).forEach((input) => {
    input.checked = shouldSelect;
    if (shouldSelect) set.add(input.value);
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
  const rows = sortRows(state.rows).filter((row) => {
    return state.selectedFormats.has(row.format) &&
      state.selectedDetails.has(row.detail) &&
      matchesKeyword(row, keyword);
  });
  state.filteredRows = rows;

  $("#list-count").textContent = `${rows.length}件表示`;

  if (!rows.length) {
    $("#song-table-body").innerHTML = `<tr><td colspan="11"><div class="empty">条件に合う歌唱がありません。</div></td></tr>`;
    return;
  }

  $("#song-table-body").innerHTML = rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row["日付"])}</td>
      <td>${escapeHtml(row.format)}</td>
      <td>${escapeHtml(row.detail)}</td>
      <td><span class="song-title">${escapeHtml(row["曲名"])}</span></td>
      <td>${escapeHtml(row["アーティスト名"])}</td>
      <td>${escapeHtml(row["コラボ"]) || ""}</td>
      <td>${escapeHtml(row.channel) || ""}</td>
      <td>
        ${escapeHtml(row["配信タイトル"])}
        ${row["関連元"] ? `<span class="subtext">関連元: ${escapeHtml(row["関連元"])}</span>` : ""}
      </td>
      <td>${renderListenLink(row)}</td>
      <td>${escapeHtml(row["備考"])}</td>
    </tr>
  `).join("");
}

function isFullCoverRow(row) {
  return row.format === "Video" && COVER_VIDEO_DETAILS.has(row.detail);
}

function isShortCoverRow(row) {
  return row.format === "Shorts" && COVER_SHORT_DETAILS.has(row.detail);
}

function isCoverRow(row) {
  return isFullCoverRow(row) || isShortCoverRow(row);
}

function isSelectedCoverKind(row) {
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

function renderCovers() {
  const keyword = $("#cover-keyword").value.trim();
  const rowById = new Map(state.rows.map((row) => [row["歌唱ID"], row]));
  const allCoverRows = sortRows(state.rows).filter(isCoverRow);
  const allGroups = groupBy(allCoverRows, (row) => makeCoverGroupId(row, rowById));

  const targetRows = allCoverRows.filter((row) =>
    isSelectedCoverKind(row) && matchesKeyword(row, keyword)
  );
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
      const groupSortKey = groupRows.reduce((min, row) => row.sortKey < min ? row.sortKey : min, groupRows[0]?.sortKey || "99999999-9-999");
      const hasFullCover = groupRows.some(isFullCoverRow);
      const targetIdSet = new Set(targetRows.map((row) => row["歌唱ID"]));

      return { groupId, rows: sortedRows, representative, groupSortKey, hasFullCover, targetIdSet };
    })
    .filter((group) => group.rows.length)
    .sort((a, b) => a.groupSortKey.localeCompare(b.groupSortKey, "ja"));

  const visibleRowsCount = groups.reduce((total, group) => total + group.rows.length, 0);
  $("#cover-count").textContent = `${groups.length}件 / ${visibleRowsCount}本`;

  if (!groups.length) {
    $("#cover-cards").innerHTML = `<div class="empty">条件に合う歌ってみたがありません。</div>`;
    return;
  }

  $("#cover-cards").innerHTML = groups.map(({ groupId, rows, representative, hasFullCover, targetIdSet }) => {
    const title = representative["曲名"] || rows[0]["曲名"] || "曲名未入力";
    const artist = representative["アーティスト名"] || rows[0]["アーティスト名"] || "";
    const countText = rows.length === 1 ? "1本" : `${rows.length}本`;
    const cardClass = hasFullCover ? "has-full-cover" : "short-only-cover";
    const groupLabel = hasFullCover ? "フル歌みたあり" : "Shortsのみ";

    return `
      <article class="card cover-card ${cardClass}" id="cover-${escapeHtml(groupId)}">
        <div class="card-header">
          <div class="card-meta">
            <span class="cover-group-label">${escapeHtml(groupLabel)}</span>
            <span>${escapeHtml(countText)}</span>
            ${artist ? `<span>／</span><span>${escapeHtml(artist)}</span>` : ""}
          </div>
          <h3 class="card-title">${escapeHtml(title)}</h3>
        </div>
        <div class="card-body">
          <div class="cover-entry-list">
            ${rows.map((row) => {
              const isTarget = targetIdSet.has(row["歌唱ID"]);
              const meta = [row["日付"], row.detail, row["コラボ"] ? `コラボ: ${row["コラボ"]}` : "", row.channel ? `掲載ch: ${row.channel}` : ""].filter(Boolean);
              return `
                <div class="cover-entry ${isTarget ? "" : "related-entry"}">
                  <div class="cover-entry-main">
                    <div class="badge-row">
                      <span class="badge ${isFullCoverRow(row) ? "cover-full-badge" : "cover-short-badge"}">${escapeHtml(coverKindLabel(row))}</span>
                      ${renderBadgeSpans(row)}
                      ${isTarget ? "" : `<span class="badge related-badge">関連表示</span>`}
                    </div>
                    <div class="cover-entry-title">${escapeHtml(row["配信タイトル"] || row["曲名"])}</div>
                    <div class="card-meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("<span>／</span>")}</div>
                    ${row["関連元"] ? `<span class="subtext">関連元: ${escapeHtml(row["関連元"])}</span>` : ""}
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
    .sort((a, b) => a[1][0].sortKey.localeCompare(b[1][0].sortKey, "ja"));

  $("#stream-count").textContent = `${groups.length}枠 / ${streamRows.length}曲`;

  if (!groups.length) {
    $("#stream-cards").innerHTML = `<div class="empty">条件に合う歌枠がありません。</div>`;
    return;
  }

  $("#stream-cards").innerHTML = groups.map(([videoId, rows]) => {
    const first = rows[0];
    const title = first["配信タイトル"];
    const meta = [first["日付"], first.detail, first["コラボ"] ? `コラボ: ${first["コラボ"]}` : "", first.channel ? `掲載ch: ${first.channel}` : ""].filter(Boolean);
    return `
      <article class="card stream-card" id="stream-${escapeHtml(videoId)}">
        <div class="card-header">
          <div class="card-meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("<span>／</span>")}</div>
          <h3 class="card-title">${escapeHtml(title)}</h3>
          <div class="badge-row">${renderBadges(first)}</div>
        </div>
        <div class="card-body">
          <ul class="track-list">
            ${rows.map((row) => `
              <li class="track-item">
                <span class="track-number">${escapeHtml(row["曲順"] || "-")}</span>
                <span>
                  <span class="song-title">${escapeHtml(row["曲名"])}</span>
                  <span class="subtext">${escapeHtml(row["アーティスト名"])}${row["備考"] ? ` / ${escapeHtml(row["備考"])}` : ""}</span>
                </span>
                ${renderListenLink(row)}
              </li>
            `).join("")}
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
    getArtistNames(row).forEach((artist) => {
      if (!artistMap.has(artist)) artistMap.set(artist, []);
      artistMap.get(artist).push(row);
    });
  });

  const artistGroups = [...artistMap.entries()]
    .map(([artist, rows]) => ({ artist, rows }))
    .filter((group) => {
      if (state.selectedArtist && group.artist !== state.selectedArtist) return false;
      if (!keyword) return true;
      const target = [
        group.artist,
        ...group.rows.flatMap((row) => [
          row["曲名"],
          row["アーティスト名"],
          row["検索用アーティスト名"],
        ]),
      ].join(" ").toLowerCase();
      return target.includes(keyword);
    })
    .sort((a, b) => a.artist.localeCompare(b.artist, "ja"));

  $("#artist-count").textContent = state.selectedArtist
    ? `${artistGroups.length}アーティスト / ${state.selectedArtist}で絞り込み中`
    : `${artistGroups.length}アーティスト`;

  const allArtists = getAllArtistNames(state.rows);
  $("#artist-index").innerHTML = `
    <button type="button" class="artist-index-button ${state.selectedArtist ? "" : "active"}" data-artist-filter="">全アーティスト表示</button>
    ${allArtists.map((artist) => `
      <button type="button" class="artist-index-button ${state.selectedArtist === artist ? "active" : ""}" data-artist-filter="${escapeHtml(artist)}">${escapeHtml(artist)}</button>
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
      <article class="card artist-card open">
        <div class="card-header" data-artist-toggle>
          <h3 class="card-title">
            <span>${escapeHtml(group.artist)}</span>
            <span class="artist-counts">${songGroups.length}曲 / ${group.rows.length}回</span>
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
                  <span class="song-count-muted">${rows.length}回歌唱</span>
                </div>
                <div class="song-occurrences">
                  ${rows.map((row) => `
                    <div class="occurrence">
                      <span>${escapeHtml(row["日付"])}</span>
                      <span>${escapeHtml(row.format)}</span>
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
      state.selectedArtist = button.dataset.artistFilter || "";
      renderArtists();
      $("#tab-artists").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function setupTabs() {
  $$('.tab-button').forEach((button) => {
    button.addEventListener("click", () => {
      $$('.tab-button').forEach((btn) => btn.classList.remove("active"));
      $$('.tab-panel').forEach((panel) => panel.classList.remove("active"));
      button.classList.add("active");
      $(`#tab-${button.dataset.tab}`).classList.add("active");
      history.replaceState(null, "", `#${button.dataset.tab}`);
    });
  });

  const initialTab = location.hash.replace("#", "");
  if (["list", "covers", "streams", "artists"].includes(initialTab)) {
    document.querySelector(`[data-tab="${initialTab}"]`).click();
  }
}

function setupEvents() {
  $("#keyword").addEventListener("input", renderList);
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
  $("#stream-keyword").addEventListener("input", renderStreams);
  $("#artist-keyword").addEventListener("input", () => {
    state.selectedArtist = "";
    renderArtists();
  });

  $("#reset-filters").addEventListener("click", () => {
    $("#keyword").value = "";
    setFilterGroup("format", true);
    setFilterGroup("detail", true);
  });

  $$('[data-filter-action]').forEach((button) => {
    button.addEventListener("click", () => {
      setFilterGroup(button.dataset.filterGroupTarget, button.dataset.filterAction === "select");
    });
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
    renderStats();
    renderFilters();
    renderList();
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
