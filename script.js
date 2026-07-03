/*
  手機版月曆記事板
  ------------------------------------------------------------
  這支檔案負責：
  1. 初始化 Supabase 連線
  2. 處理登入 / 註冊 / 登出
  3. 在資料管理頁新增、讀取記事資料
  4. 在月曆頁顯示當月日期，並在點擊日期後顯示詳細行程

  重要說明：
  ------------------------------------------------------------
  前端無法直接替你建立 Supabase 資料表，因此這份程式預設使用
  `calendar_events` 這張資料表。

  建議在 Supabase SQL Editor 建立以下欄位：

  create table public.calendar_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    event_date date not null,
    event_time time not null,
    title text not null,
    description text,
    color text,
    created_at timestamptz not null default now()
  );

  建議再加上 RLS 規則，確保使用者只能存取自己的資料。
  注意：若你的 INSERT Policy 使用 `with check (auth.uid() = user_id)`，
  前端新增資料時就一定要帶上 `user_id`，否則會被 RLS 擋下。
*/

// ------------------------------------------------------------
// Supabase 基本設定
// ------------------------------------------------------------

// 這裡直接使用你提供的 Supabase 專案 URL。
const SUPABASE_URL = "https://ppdblmxzyuacswjfftei.supabase.co";

// 這裡直接使用你提供的匿名金鑰（Anon Key）。
const SUPABASE_ANON_KEY =
  "sb_publishable_tsCRBSYpSzq9iPW2wQCRPQ_eMIKzbjf";

// 統一管理資料表名稱，之後如果你想改表名，只要改這裡即可。
const EVENTS_TABLE = "calendar_events";

// 透過 CDN 載入的 supabase-js 會掛在全域 `supabase` 物件底下。
// 建立 client 之後，整個前端都會共用這個連線實例。
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------------------------------------------------------
// 共用工具函式
// ------------------------------------------------------------

// 簡短的 DOM 查詢工具，讓後面的程式碼更好讀。
const $ = (selector) => document.querySelector(selector);

// 依照頁面 body 上的 data-page 來決定目前是哪一頁。
const currentPage = document.body.dataset.page;
const CROSS_PAGE_EDIT_STORAGE_KEY = "calendar-cross-page-edit";

// 統一格式化錯誤訊息，避免直接把完整錯誤物件印到畫面上。
function getErrorMessage(error, fallbackText) {
  return error?.message || fallbackText;
}

// 將日期格式化成 `YYYY-MM-DD`，方便和資料庫欄位對接。
function formatDateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 產生只顯示年月的標題，例如 `2026 年 6 月`。
function formatMonthTitle(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

// 顯示較親切的日期標籤，例如 `2026/06/12`。
function formatDateLabel(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${year}/${month}/${day}`;
}

function formatMonthValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatMonthLabel(monthValue) {
  const [year, month] = String(monthValue || "").split("-");
  if (!year || !month) return "全部";
  return `${year}/${month}`;
}

// 將 `HH:mm:ss` 或 `HH:mm` 都整理成 `HH:mm`。
function formatTimeLabel(timeValue = "") {
  return timeValue.slice(0, 5);
}

// 將使用者輸入的文字做最基本的 HTML 轉義，避免直接插入標籤。
function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function splitGraphemes(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return [];

  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("zh-Hant", { granularity: "grapheme" });
    return Array.from(segmenter.segment(normalized), (item) => item.segment).filter((item) =>
      item.trim()
    );
  }

  return Array.from(normalized).filter((item) => item.trim());
}

function normalizeEmojiText(value = "", maxCount = 3) {
  const normalized = String(value || "").trim();
  if (!normalized || /^#([0-9a-fA-F]{6})$/.test(normalized)) return "";
  return splitGraphemes(normalized).slice(0, maxCount).join("");
}

function collectDayEmojiText(events, maxCount = 3) {
  const tokens = [];

  events.forEach((event) => {
    splitGraphemes(normalizeEmojiText(event.color)).forEach((emoji) => {
      if (tokens.length < maxCount) {
        tokens.push(emoji);
      }
    });
  });

  return tokens.join("");
}

// 設定狀態訊息文字與顏色。
function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.classList.remove("is-error", "is-success");

  if (type === "error") element.classList.add("is-error");
  if (type === "success") element.classList.add("is-success");
}

function saveCrossPageEditEntry(entry) {
  if (!entry) return;

  try {
    window.sessionStorage.setItem(CROSS_PAGE_EDIT_STORAGE_KEY, JSON.stringify(entry));
  } catch (error) {
    console.warn("無法暫存跨頁修改資料：", error);
  }
}

function takeCrossPageEditEntry() {
  try {
    const rawValue = window.sessionStorage.getItem(CROSS_PAGE_EDIT_STORAGE_KEY);
    if (!rawValue) return null;

    window.sessionStorage.removeItem(CROSS_PAGE_EDIT_STORAGE_KEY);
    return JSON.parse(rawValue);
  } catch (error) {
    console.warn("無法讀取跨頁修改資料：", error);
    window.sessionStorage.removeItem(CROSS_PAGE_EDIT_STORAGE_KEY);
    return null;
  }
}

// 空狀態 UI，當列表沒有資料時給使用者清楚提示。
function renderEmptyState(targetElement, message) {
  if (!targetElement) return;
  targetElement.innerHTML = `
    <li class="entry-item">
      <p class="entry-note">${message}</p>
    </li>
  `;
}

function renderEmptyActionState(targetElement, isoDate, onAction) {
  if (!targetElement) return;

  targetElement.innerHTML = `
    <li class="entry-item">
      <button
        type="button"
        class="empty-day-action"
        data-empty-date="${escapeHtml(isoDate)}"
        aria-label="為 ${escapeHtml(formatDateLabel(isoDate))} 新增或修改記事"
      >
        <span class="empty-day-action__text">這一天目前沒有行程，點這裡新增或修改記事。</span>
        <span class="empty-day-action__icon" aria-hidden="true">✏️</span>
      </button>
    </li>
  `;

  if (typeof onAction === "function") {
    targetElement.querySelector("[data-empty-date]")?.addEventListener("click", () => {
      onAction(isoDate);
    });
  }
}

// 文章列表與月曆詳情共用的記事卡片渲染函式。
// 可透過 options 控制：
// - showDate: 是否顯示每筆資料的日期
// - editable: 是否顯示「修改」按鈕
// - onEdit: 點擊修改後要執行的函式
// - onDelete: 點擊刪除後要執行的函式
function renderEventCards(targetElement, events, options = {}) {
  if (!targetElement) return;
  const {
    showDate = false,
    editable = false,
    quickEdit = false,
    onEdit = null,
    onDelete = null,
    onQuickEdit = null,
  } = options;

  if (!events.length) {
    renderEmptyState(targetElement, "目前沒有資料。");
    return;
  }

  targetElement.innerHTML = events
    .map((event) => {
      const emojiText = normalizeEmojiText(event.color);

      return `
        <li class="entry-item ${quickEdit ? "entry-item--quick-edit" : ""}">
          ${showDate ? `<p class="entry-date-line">${formatDateLabel(event.event_date)}</p>` : ""}
          <div class="entry-meta">
            <div class="entry-meta-left">
              ${
                emojiText
                  ? `<span class="entry-emoji-badge" aria-label="主題 Emoji">${escapeHtml(emojiText)}</span>`
                  : ""
              }
              <span class="entry-time">${formatTimeLabel(event.event_time)}</span>
            </div>
            <span class="entry-topic">${escapeHtml(event.title)}</span>
          </div>
          <p class="entry-note">${escapeHtml(event.description?.trim() || "沒有備註")}</p>
          ${
            editable
              ? `
                <div class="entry-actions">
                  <button type="button" class="edit-button" data-edit-id="${escapeHtml(event.id)}">
                    修改
                  </button>
                  <button type="button" class="delete-button" data-delete-id="${escapeHtml(event.id)}">
                    剷除
                  </button>
                </div>
              `
              : ""
          }
          ${
            quickEdit
              ? `
                <button
                  type="button"
                  class="entry-quick-edit-button"
                  data-quick-edit-id="${escapeHtml(event.id)}"
                  aria-label="修改這則記事"
                  title="修改"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path
                      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 7.04a1.003 1.003 0 0 0 0-1.42L18.37 3.29a1.003 1.003 0 0 0-1.42 0l-1.13 1.13 3.75 3.75 1.14-1.13z"
                    />
                  </svg>
                </button>
              `
              : ""
          }
        </li>
      `;
    })
    .join("");

  if (editable && typeof onEdit === "function") {
    targetElement.querySelectorAll("[data-edit-id]").forEach((button) => {
      button.addEventListener("click", () => {
        onEdit(button.dataset.editId);
      });
    });
  }

  if (editable && typeof onDelete === "function") {
    targetElement.querySelectorAll("[data-delete-id]").forEach((button) => {
      button.addEventListener("click", () => {
        onDelete(button.dataset.deleteId);
      });
    });
  }

  if (quickEdit && typeof onQuickEdit === "function") {
    targetElement.querySelectorAll("[data-quick-edit-id]").forEach((button) => {
      button.addEventListener("click", () => {
        onQuickEdit(button.dataset.quickEditId);
      });
    });
  }
}

// 取得目前登入中的使用者。
async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabaseClient.auth.getUser();

  if (error) throw error;
  return user;
}

// ------------------------------------------------------------
// Index 頁：登入 / 註冊 / 資料管理
// ------------------------------------------------------------

let authMode = "login";
// 快捷輸入區預設日期：今天（新增事件一定需要日期）
let selectedEntryDate = formatDateToISO(new Date());

async function initIndexPage() {
  const authSection = $("#auth-section");
  const appSection = $("#app-section");
  const authForm = $("#auth-form");
  const loginTab = $("#login-tab");
  const registerTab = $("#register-tab");
  const authSubmitButton = $("#auth-submit-button");
  const authMessage = $("#auth-message");
  const toggleControlsButton = $("#toggle-controls-button");
  const controlsPanel = $("#controls-panel");
  const filterDateInput = $("#filter-date");
  const filterMonthInput = $("#filter-month");
  const clearFilterButton = $("#clear-filter-button");
  const quickDateInput = $("#quick-date");
  const quickEntryForm = $("#quick-entry-form");
  const addEntryButton = $("#add-entry-button");
  const cancelEditButton = $("#cancel-edit-button");
  const listStatus = $("#list-status");
  const entryEmojiInput = $("#entry-emoji");

  // 歷史資料篩選日期（空字串代表「不篩選，顯示全部」）
  let filterDate = "";
  let filterMonth = "";
  let editingEntryId = null;
  let latestRenderedEntries = [];

  // 初始化：
  // - 篩選器預設不選日期（顯示全部歷史資料）
  // - 快捷輸入區預設今天（方便快速新增）
  filterDateInput.value = "";
  filterMonthInput.value = "";
  quickDateInput.value = selectedEntryDate;
  updateCurrentDateLabel();

  // 收合/展開首頁控制面板，讓手機畫面先優先顯示記事列表。
  function setControlsExpanded(expanded) {
    if (!controlsPanel || !toggleControlsButton) return;
    controlsPanel.classList.toggle("is-collapsed", !expanded);
    toggleControlsButton.setAttribute("aria-expanded", String(expanded));
    toggleControlsButton.textContent = expanded ? "收起新增 / 篩選" : "➕ 新增 / 篩選";
  }

  // 依照目前是否在修改模式，切換送出區按鈕文字與取消按鈕顯示。
  function updateEditorModeUI() {
    const isEditing = Boolean(editingEntryId);
    if (addEntryButton) {
      addEntryButton.textContent = isEditing ? "更新記事" : "新增記事";
    }
    if (cancelEditButton) {
      cancelEditButton.classList.toggle("hidden", !isEditing);
    }
  }

  function resetEditorForm() {
    quickDateInput.value = formatDateToISO(new Date());
    selectedEntryDate = quickDateInput.value;
    $("#entry-time").value = "";
    $("#entry-title").value = "";
    $("#entry-description").value = "";
    if (entryEmojiInput) {
      entryEmojiInput.value = "";
    }
  }

  function fillEditorForm(entry) {
    if (!entry) return;

    editingEntryId = entry.id || null;
    selectedEntryDate = entry.event_date || formatDateToISO(new Date());
    quickDateInput.value = selectedEntryDate;
    $("#entry-time").value = formatTimeLabel(entry.event_time || "");
    $("#entry-title").value = entry.title || "";
    $("#entry-description").value = entry.description || "";
    if (entryEmojiInput) {
      entryEmojiInput.value = normalizeEmojiText(entry.color);
    }
    updateEditorModeUI();
    setControlsExpanded(true);
  }

  function stopEditing({ keepValues = false } = {}) {
    editingEntryId = null;
    updateEditorModeUI();
    if (!keepValues) {
      resetEditorForm();
    }
  }

  function startEditing(entryId) {
    const targetEntry = latestRenderedEntries.find((entry) => entry.id === entryId);
    if (!targetEntry) return;

    fillEditorForm(targetEntry);
    setStatus(listStatus, "已帶入舊資料，請修改後按「更新記事」，或按「取消」退出編輯。");
  }

  async function resumeCrossPageEditIfNeeded() {
    if (appSection?.classList.contains("hidden")) return;

    const pendingEntry = takeCrossPageEditEntry();
    if (!pendingEntry) return;

    try {
      filterDate = pendingEntry.event_date || "";
      filterMonth = "";
      filterDateInput.value = filterDate;
      filterMonthInput.value = "";

      if (filterDate) {
        await loadEntriesForDate(filterDate);
      } else {
        await loadAllEntries();
      }

      const matchedEntry = latestRenderedEntries.find((entry) => entry.id === pendingEntry.id);
      fillEditorForm(matchedEntry || pendingEntry);
      setStatus(listStatus, "已從月曆詳情帶入記事，你可以直接修改內容。", "success");
      $("#quick-entry-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      fillEditorForm(pendingEntry);
      setStatus(
        listStatus,
        getErrorMessage(error, "已帶入記事內容，但清單同步時發生問題。"),
        "error"
      );
      $("#quick-entry-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function deleteEntry(entryId) {
    const targetEntry = latestRenderedEntries.find((entry) => entry.id === entryId);
    if (!targetEntry) return;

    const shouldDelete = window.confirm(
      `確定要剷除 ${formatDateLabel(targetEntry.event_date)} ${formatTimeLabel(
        targetEntry.event_time
      )} 的「${targetEntry.title}」嗎？`
    );

    if (!shouldDelete) return;

    try {
      setStatus(listStatus, "正在剷除記事...");

      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");

      const { error } = await supabaseClient
        .from(EVENTS_TABLE)
        .delete()
        .eq("id", entryId)
        .eq("user_id", user.id);

      if (error) throw error;

      if (editingEntryId === entryId) {
        stopEditing();
      }

      await refreshEntries();
      setStatus(listStatus, "記事已成功剷除。", "success");
    } catch (error) {
      setStatus(
        listStatus,
        getErrorMessage(error, "刪除資料失敗，請檢查資料表與權限設定。"),
        "error"
      );
    }
  }

  // 切換登入 / 註冊模式。
  function switchAuthMode(mode) {
    authMode = mode;
    loginTab.classList.toggle("is-active", mode === "login");
    registerTab.classList.toggle("is-active", mode === "register");
    authSubmitButton.textContent = mode === "login" ? "登入" : "註冊";
    setStatus(authMessage, mode === "login" ? "請輸入帳號密碼登入。" : "建立新帳號後即可開始使用。");
  }

  // 根據登入狀態切換顯示哪個區塊。
  async function togglePageBySession() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    const isLoggedIn = Boolean(session);
    authSection.classList.toggle("hidden", isLoggedIn);
    appSection.classList.toggle("hidden", !isLoggedIn);

    if (isLoggedIn) {
      setStatus(authMessage, "");
      await refreshEntries();
    }
  }

  // 寫在內部函式中，讓資料管理頁能重複呼叫。
  async function loadEntriesForDate(isoDate) {
    try {
      setStatus(listStatus, "正在讀取記事資料...");
      updateCurrentDateLabel();

      // 先取得 user.id，讓查詢/新增都能帶上 user_id 通過 RLS 的 auth.uid() 檢查
      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");

      const { data, error } = await supabaseClient
        .from(EVENTS_TABLE)
        .select("id,user_id,event_date,event_time,title,description,color")
        .eq("user_id", user.id)
        .eq("event_date", isoDate)
        .order("event_time", { ascending: true });

      if (error) throw error;

      latestRenderedEntries = data || [];
      renderEventCards($("#entry-list"), latestRenderedEntries, {
        editable: true,
        showDate: false,
        onEdit: startEditing,
        onDelete: deleteEntry,
      });
      setStatus(listStatus, `已載入 ${formatDateLabel(isoDate)} 的記事資料。`, "success");
    } catch (error) {
      // 注意：資料是 0 筆時不會進到 catch（因為 Supabase 會回傳空陣列 data: []）
      // 只有真正出錯（例如 RLS 擋住、欄位不存在）才會到這裡。
      renderEmptyState($("#entry-list"), "目前沒有資料。");
      setStatus(
        listStatus,
        `讀取失敗：${getErrorMessage(
          error,
          "暫時無法讀取資料，請確認 Supabase 資料表與 RLS 規則是否已設定完成。"
        )}`,
        "error"
      );
    }
  }

  async function loadEntriesForMonth(monthValue) {
    try {
      setStatus(listStatus, "正在讀取月份資料...");
      updateCurrentDateLabel();

      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");

      const [year, month] = monthValue.split("-").map(Number);
      const firstDate = formatDateToISO(new Date(year, month - 1, 1));
      const lastDate = formatDateToISO(new Date(year, month, 0));

      const { data, error } = await supabaseClient
        .from(EVENTS_TABLE)
        .select("id,user_id,event_date,event_time,title,description,color")
        .eq("user_id", user.id)
        .gte("event_date", firstDate)
        .lte("event_date", lastDate)
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true });

      if (error) throw error;

      latestRenderedEntries = data || [];
      renderEventCards($("#entry-list"), latestRenderedEntries, {
        editable: true,
        showDate: true,
        onEdit: startEditing,
        onDelete: deleteEntry,
      });
      setStatus(listStatus, `已載入 ${formatMonthLabel(monthValue)} 的記事資料。`, "success");
    } catch (error) {
      renderEmptyState($("#entry-list"), "目前沒有資料。");
      setStatus(
        listStatus,
        `讀取失敗：${getErrorMessage(
          error,
          "暫時無法讀取資料，請確認 Supabase 資料表與 RLS 規則是否已設定完成。"
        )}`,
        "error"
      );
    }
  }

  // 未選擇日期時：載入「所有」歷史資料
  async function loadAllEntries() {
    try {
      setStatus(listStatus, "正在讀取所有歷史資料...");
      updateCurrentDateLabel();

      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");

      const { data, error } = await supabaseClient
        .from(EVENTS_TABLE)
        .select("id,user_id,event_date,event_time,title,description,color")
        .eq("user_id", user.id)
        .order("event_date", { ascending: false })
        .order("event_time", { ascending: true });

      if (error) throw error;

      latestRenderedEntries = data || [];
      renderEventCards($("#entry-list"), latestRenderedEntries, {
        editable: true,
        showDate: true,
        onEdit: startEditing,
        onDelete: deleteEntry,
      });
      setStatus(listStatus, "已載入所有歷史資料。", "success");
    } catch (error) {
      renderEmptyState($("#entry-list"), "目前沒有資料。");
      setStatus(
        listStatus,
        `讀取失敗：${getErrorMessage(
          error,
          "暫時無法讀取資料，請確認 Supabase 資料表與 RLS 規則是否已設定完成。"
        )}`,
        "error"
      );
    }
  }

  // 統一刷新列表（依據目前 filterDate 決定要載入全部或單日）
  async function refreshEntries() {
    if (filterDate) {
      await loadEntriesForDate(filterDate);
      return;
    }

    if (filterMonth) {
      await loadEntriesForMonth(filterMonth);
      return;
    }

    await loadAllEntries();
  }

  // 把當前選取日期顯示在列表右上角。
  function updateCurrentDateLabel() {
    const label = $("#current-date-label");
    if (!label) return;
    if (filterDate) {
      label.textContent = formatDateLabel(filterDate);
      return;
    }
    if (filterMonth) {
      label.textContent = formatMonthLabel(filterMonth);
      return;
    }
    label.textContent = "全部";
  }

  // 處理登入或註冊送出。
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value.trim();

    if (!email || !password) {
      setStatus(authMessage, "請完整輸入電子郵件與密碼。", "error");
      return;
    }

    try {
      setStatus(authMessage, authMode === "login" ? "登入中..." : "建立帳號中...");

      if (authMode === "login") {
        const { error } = await supabaseClient.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setStatus(authMessage, "登入成功。", "success");
      } else {
        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
        });
        if (error) throw error;

        // 某些 Supabase 專案會要求先驗證 Email。
        // 若目前尚未拿到 session，就提示使用者查看信箱。
        if (!data.session) {
          setStatus(
            authMessage,
            "註冊成功，請先到信箱完成驗證後再登入。",
            "success"
          );
        } else {
          setStatus(authMessage, "註冊並登入成功。", "success");
        }
      }

      authForm.reset();
      await togglePageBySession();
    } catch (error) {
      setStatus(
        authMessage,
        getErrorMessage(error, "登入或註冊失敗，請稍後再試。"),
        "error"
      );
    }
  });

  // 切換登入 / 註冊分頁。
  loginTab.addEventListener("click", () => switchAuthMode("login"));
  registerTab.addEventListener("click", () => switchAuthMode("register"));

  // 「歷史資料篩選器」：
  // - 選定日期：只顯示該日事件
  // - 選定月份：顯示該月份所有事件
  filterDateInput.addEventListener("change", async (event) => {
    filterDate = event.target.value || "";
    if (filterDate) {
      filterMonth = "";
      filterMonthInput.value = "";
    }
    await refreshEntries();
  });

  filterMonthInput.addEventListener("change", async (event) => {
    filterMonth = event.target.value || "";
    if (filterMonth) {
      filterDate = "";
      filterDateInput.value = "";
    }
    await refreshEntries();
  });

  // 「顯示全部」：一鍵清除日期篩選
  clearFilterButton?.addEventListener("click", async () => {
    filterDate = "";
    filterMonth = "";
    filterDateInput.value = "";
    filterMonthInput.value = "";
    await loadAllEntries();
  });

  // 快捷輸入區內的日期：只影響「新增事件的日期」，不再強制同步到篩選器
  quickDateInput.addEventListener("change", async (event) => {
    selectedEntryDate = event.target.value || formatDateToISO(new Date());
  });

  // 核心功能：快捷輸入區新增記事。
  quickEntryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const entryTime = $("#entry-time");
    const entryTitle = $("#entry-title");
    const entryDescription = $("#entry-description");

    if (!selectedEntryDate) {
      setStatus(listStatus, "請先選擇日期。", "error");
      return;
    }

    if (!entryTime.value || !entryTitle.value.trim()) {
      setStatus(listStatus, "請輸入時間與主題。", "error");
      return;
    }

    try {
      setStatus(listStatus, "正在新增記事...");

      // 這裡只用 getUser() 來確認登入狀態是否有效。
      // 實際資料隔離（只看自己的資料）建議交給 Supabase RLS 來負責。
      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");

      const payload = {
        // 你的 RLS INSERT Policy 會檢查 `auth.uid() = user_id`
        // 因此前端新增時必須帶上 user_id（就是目前登入者的 UUID）
        user_id: user.id,
        event_date: selectedEntryDate,
        event_time: entryTime.value,
        title: entryTitle.value.trim(),
        description: entryDescription.value.trim(),
        color: normalizeEmojiText(entryEmojiInput?.value),
      };

      if (editingEntryId) {
        const { error } = await supabaseClient
          .from(EVENTS_TABLE)
          .update(payload)
          .eq("id", editingEntryId)
          .eq("user_id", user.id);
        if (error) throw error;

        stopEditing();
        await refreshEntries();
        setStatus(listStatus, "記事已更新，列表已即時同步。", "success");
      } else {
        const { error } = await supabaseClient.from(EVENTS_TABLE).insert(payload);
        if (error) throw error;

        stopEditing();
        await refreshEntries();
        setStatus(listStatus, "記事已新增，列表已即時更新。", "success");
      }
    } catch (error) {
      setStatus(
        listStatus,
        getErrorMessage(error, "新增資料失敗，請檢查資料表與權限設定。"),
        "error"
      );
    }
  });

  entryEmojiInput?.addEventListener("input", () => {
    entryEmojiInput.value = normalizeEmojiText(entryEmojiInput.value);
  });
  toggleControlsButton?.addEventListener("click", () => {
    const willExpand = controlsPanel?.classList.contains("is-collapsed");
    setControlsExpanded(Boolean(willExpand));
  });
  cancelEditButton?.addEventListener("click", () => {
    stopEditing();
    setControlsExpanded(false);
    setStatus(listStatus, "已取消修改，不會儲存任何變更。");
  });

  // 監聽 Supabase Auth 狀態，讓登入 / 登出畫面自動切換。
  supabaseClient.auth.onAuthStateChange(async () => {
    await togglePageBySession();
    await resumeCrossPageEditIfNeeded();
  });

  // 頁面初次載入時先決定顯示哪個區塊。
  switchAuthMode("login");
  updateEditorModeUI();
  setControlsExpanded(false);
  await togglePageBySession();
  await resumeCrossPageEditIfNeeded();
}

// ------------------------------------------------------------
// Calendar 頁：月曆顯示與日期詳情
// ------------------------------------------------------------

let calendarCurrentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarEvents = [];
let selectedCalendarDate = formatDateToISO(new Date());

async function initCalendarPage() {
  const monthTitle = $("#calendar-month-title");
  const calendarGrid = $("#calendar-grid");
  const selectedDateTitle = $("#selected-date-title");
  const selectedDateList = $("#selected-date-list");
  const calendarStatus = $("#calendar-status");
  const prevMonthButton = $("#prev-month-button");
  const currentMonthButton = $("#current-month-button");
  const nextMonthButton = $("#next-month-button");

  // 月曆頁必須登入才能使用，沒有 session 就導回首頁。
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = "./index.html";
    return;
  }

  // 載入指定月份資料。
  async function loadMonthEvents(baseDate) {
    try {
      setStatus(calendarStatus, "正在載入月曆資料...");

      // 同樣先確認登入狀態（避免 session 過期），並拿到 user.id 以配合 RLS 查詢。
      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");
      const year = baseDate.getFullYear();
      const month = baseDate.getMonth();
      const firstDate = formatDateToISO(new Date(year, month, 1));
      const lastDate = formatDateToISO(new Date(year, month + 1, 0));

      const { data, error } = await supabaseClient
        .from(EVENTS_TABLE)
        .select("id,event_date,event_time,title,description,color")
        .eq("user_id", user.id)
        .gte("event_date", firstDate)
        .lte("event_date", lastDate)
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true });

      if (error) throw error;

      calendarEvents = data || [];
      setStatus(calendarStatus, `${formatMonthTitle(baseDate)}資料已載入。`, "success");
      renderCalendar(baseDate);

      // 若當前選定日期不在這個月份，就自動切到這個月的第一天。
      if (!selectedCalendarDate.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) {
        selectedCalendarDate = firstDate;
      }

      renderSelectedDateDetails(selectedCalendarDate);
    } catch (error) {
      calendarGrid.innerHTML = "";
      renderEmptyState(
        selectedDateList,
        "無法載入該月份資料，請確認資料表已建立且權限設定正確。"
      );
      setStatus(
        calendarStatus,
        getErrorMessage(error, "讀取月曆資料失敗。"),
        "error"
      );
    }
  }

  // 建立「日期 => 資料陣列」的索引，方便月曆與詳情區快速查詢。
  function buildEventMap() {
    return calendarEvents.reduce((map, event) => {
      if (!map[event.event_date]) {
        map[event.event_date] = [];
      }
      map[event.event_date].push(event);
      return map;
    }, {});
  }

  function jumpToIndexForEditing(entryId) {
    const targetEntry = calendarEvents.find((entry) => entry.id === entryId);
    if (!targetEntry) return;

    saveCrossPageEditEntry(targetEntry);
    window.location.href = "./index.html";
  }

  function jumpToIndexForNewEntry(isoDate) {
    saveCrossPageEditEntry({ event_date: isoDate });
    window.location.href = "./index.html";
  }

  // 畫出月曆格子。
  function renderCalendar(baseDate) {
    const eventMap = buildEventMap();
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();
    const leadingBlankDays = firstDay.getDay();

    monthTitle.textContent = formatMonthTitle(baseDate);
    calendarGrid.innerHTML = "";

    // 先補齊月初前面的空白日期，讓整個 7 欄網格保持整齊。
    for (let i = 0; i < leadingBlankDays; i += 1) {
      const blankCell = document.createElement("div");
      blankCell.className = "calendar-day is-muted";
      blankCell.setAttribute("aria-hidden", "true");
      calendarGrid.appendChild(blankCell);
    }

    // 逐天建立月曆格子。
    for (let day = 1; day <= totalDays; day += 1) {
      const isoDate = formatDateToISO(new Date(year, month, day));
      const dayEvents = eventMap[isoDate] || [];
      const emojiText = collectDayEmojiText(dayEvents, 3);
      const shouldShowEmojis = Boolean(emojiText) && dayEvents.length >= 1 && dayEvents.length <= 3;
      const shouldShowPill = dayEvents.length >= 4;
      const dayButton = document.createElement("button");

      dayButton.type = "button";
      dayButton.className = "calendar-day";

      if (dayEvents.length) {
        dayButton.classList.add("has-events");
      }

      if (isoDate === selectedCalendarDate) {
        dayButton.classList.add("is-selected");
      }

      dayButton.innerHTML = `
        <div class="calendar-day-header">
          <span class="day-number">${day}</span>
        </div>
        <div class="calendar-day-footer">
          ${
            shouldShowEmojis
              ? `<div class="event-emojis" aria-label="當天主題 Emoji">${escapeHtml(emojiText)}</div>`
              : ""
          }
          ${
            shouldShowPill
              ? `<span class="calendar-summary-pill" aria-label="共有 ${dayEvents.length} 筆事件">+${dayEvents.length}</span>`
              : ""
          }
        </div>
      `;

      // 核心需求：點擊日期後，直接在月曆下方顯示當天所有行程詳情。
      dayButton.addEventListener("click", () => {
        selectedCalendarDate = isoDate;
        renderCalendar(baseDate);
        renderSelectedDateDetails(isoDate);
      });

      calendarGrid.appendChild(dayButton);
    }
  }

  // 顯示使用者點擊的日期詳細內容。
  function renderSelectedDateDetails(isoDate) {
    const dayEvents = calendarEvents.filter((event) => event.event_date === isoDate);
    selectedDateTitle.textContent = `${formatDateLabel(isoDate)} 行程詳情`;

    if (!dayEvents.length) {
      renderEmptyActionState(selectedDateList, isoDate, jumpToIndexForNewEntry);
      return;
    }

    renderEventCards(selectedDateList, dayEvents, {
      quickEdit: true,
      onQuickEdit: jumpToIndexForEditing,
    });
  }

  prevMonthButton.addEventListener("click", async () => {
    calendarCurrentMonth = new Date(
      calendarCurrentMonth.getFullYear(),
      calendarCurrentMonth.getMonth() - 1,
      1
    );
    await loadMonthEvents(calendarCurrentMonth);
  });

  nextMonthButton.addEventListener("click", async () => {
    calendarCurrentMonth = new Date(
      calendarCurrentMonth.getFullYear(),
      calendarCurrentMonth.getMonth() + 1,
      1
    );
    await loadMonthEvents(calendarCurrentMonth);
  });

  currentMonthButton?.addEventListener("click", async () => {
    const today = new Date();
    calendarCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedCalendarDate = formatDateToISO(today);
    await loadMonthEvents(calendarCurrentMonth);
  });

  await loadMonthEvents(calendarCurrentMonth);
}

// ------------------------------------------------------------
// 頁面啟動
// ------------------------------------------------------------

// 使用 DOMContentLoaded，確保頁面元素都建立完成後才開始綁定事件。
window.addEventListener("DOMContentLoaded", async () => {
  try {
    if (currentPage === "index") {
      await initIndexPage();
    }

    if (currentPage === "calendar") {
      await initCalendarPage();
    }
  } catch (error) {
    console.error("初始化失敗：", error);
  }
});
