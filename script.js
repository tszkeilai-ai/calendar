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
    topic text not null,
    note text,
    created_at timestamptz not null default now()
  );

  建議再加上適當的 RLS 規則，確保使用者只能存取自己的資料。
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

// 設定狀態訊息文字與顏色。
function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.classList.remove("is-error", "is-success");

  if (type === "error") element.classList.add("is-error");
  if (type === "success") element.classList.add("is-success");
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

// 文章列表與月曆詳情共用的記事卡片渲染函式。
function renderEventCards(targetElement, events) {
  if (!targetElement) return;

  if (!events.length) {
    renderEmptyState(targetElement, "目前沒有資料。");
    return;
  }

  targetElement.innerHTML = events
    .map(
      (event) => `
        <li class="entry-item">
          <div class="entry-meta">
            <span class="entry-time">${formatTimeLabel(event.event_time)}</span>
            <span class="entry-topic">${escapeHtml(event.topic)}</span>
          </div>
          <p class="entry-note">${escapeHtml(event.note?.trim() || "沒有備註")}</p>
        </li>
      `
    )
    .join("");
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
let selectedEntryDate = formatDateToISO(new Date());

async function initIndexPage() {
  const authSection = $("#auth-section");
  const appSection = $("#app-section");
  const authForm = $("#auth-form");
  const loginTab = $("#login-tab");
  const registerTab = $("#register-tab");
  const authSubmitButton = $("#auth-submit-button");
  const authMessage = $("#auth-message");
  const logoutButton = $("#logout-button");
  const entryDateInput = $("#entry-date");
  const quickEntryForm = $("#quick-entry-form");
  const listStatus = $("#list-status");

  // 初始化日期欄位，預設直接使用今天，方便手機上快速新增記事。
  entryDateInput.value = selectedEntryDate;
  updateCurrentDateLabel(selectedEntryDate);

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
      await loadEntriesForDate(selectedEntryDate);
    }
  }

  // 寫在內部函式中，讓資料管理頁能重複呼叫。
  async function loadEntriesForDate(isoDate) {
    try {
      setStatus(listStatus, "正在讀取記事資料...");
      updateCurrentDateLabel(isoDate);

      const user = await getCurrentUser();
      if (!user) {
        renderEmptyState($("#entry-list"), "請先登入後再查看資料。");
        return;
      }

      const { data, error } = await supabaseClient
        .from(EVENTS_TABLE)
        .select("*")
        .eq("user_id", user.id)
        .eq("event_date", isoDate)
        .order("event_time", { ascending: true });

      if (error) throw error;

      renderEventCards($("#entry-list"), data || []);
      setStatus(listStatus, `已載入 ${formatDateLabel(isoDate)} 的記事資料。`, "success");
    } catch (error) {
      renderEmptyState(
        $("#entry-list"),
        "暫時無法讀取資料，請確認 Supabase 資料表與 RLS 規則是否已設定完成。"
      );
      setStatus(
        listStatus,
        getErrorMessage(error, "讀取資料失敗，請稍後再試。"),
        "error"
      );
    }
  }

  // 把當前選取日期顯示在列表右上角。
  function updateCurrentDateLabel(isoDate) {
    const label = $("#current-date-label");
    if (label) label.textContent = formatDateLabel(isoDate);
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

  // 登出後回到認證畫面。
  logoutButton.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    renderEmptyState($("#entry-list"), "請先登入後再查看資料。");
    appSection.classList.add("hidden");
    authSection.classList.remove("hidden");
    setStatus(authMessage, "你已登出。");
  });

  // 使用者切換日期時，立即重新載入該天資料。
  entryDateInput.addEventListener("change", async (event) => {
    selectedEntryDate = event.target.value || formatDateToISO(new Date());
    await loadEntriesForDate(selectedEntryDate);
  });

  // 核心功能：快捷輸入區新增記事。
  quickEntryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const entryTime = $("#entry-time");
    const entryTopic = $("#entry-topic");
    const entryNote = $("#entry-note");

    if (!selectedEntryDate) {
      setStatus(listStatus, "請先選擇日期。", "error");
      return;
    }

    if (!entryTime.value || !entryTopic.value.trim()) {
      setStatus(listStatus, "請輸入時間與主題。", "error");
      return;
    }

    try {
      setStatus(listStatus, "正在新增記事...");

      const user = await getCurrentUser();
      if (!user) {
        setStatus(listStatus, "登入狀態已失效，請重新登入。", "error");
        return;
      }

      const payload = {
        user_id: user.id,
        event_date: selectedEntryDate,
        event_time: entryTime.value,
        topic: entryTopic.value.trim(),
        note: entryNote.value.trim(),
      };

      const { error } = await supabaseClient.from(EVENTS_TABLE).insert(payload);
      if (error) throw error;

      // 依照你的需求，新增成功後立即清空輸入欄位。
      entryTime.value = "";
      entryTopic.value = "";
      entryNote.value = "";

      // 不重新整理頁面，直接重新抓取同一天的資料來更新列表。
      await loadEntriesForDate(selectedEntryDate);
      setStatus(listStatus, "記事已新增，列表已即時更新。", "success");
    } catch (error) {
      setStatus(
        listStatus,
        getErrorMessage(error, "新增資料失敗，請檢查資料表與權限設定。"),
        "error"
      );
    }
  });

  // 監聽 Supabase Auth 狀態，讓登入 / 登出畫面自動切換。
  supabaseClient.auth.onAuthStateChange(async () => {
    await togglePageBySession();
  });

  // 頁面初次載入時先決定顯示哪個區塊。
  switchAuthMode("login");
  await togglePageBySession();
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
  const nextMonthButton = $("#next-month-button");
  const logoutButton = $("#calendar-logout-button");

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

      const user = await getCurrentUser();
      const year = baseDate.getFullYear();
      const month = baseDate.getMonth();
      const firstDate = formatDateToISO(new Date(year, month, 1));
      const lastDate = formatDateToISO(new Date(year, month + 1, 0));

      const { data, error } = await supabaseClient
        .from(EVENTS_TABLE)
        .select("*")
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
      const blankCell = document.createElement("button");
      blankCell.type = "button";
      blankCell.className = "calendar-day is-muted";
      blankCell.disabled = true;
      blankCell.innerHTML = `<span class="day-number"></span><span class="day-count"></span>`;
      calendarGrid.appendChild(blankCell);
    }

    // 逐天建立月曆格子。
    for (let day = 1; day <= totalDays; day += 1) {
      const isoDate = formatDateToISO(new Date(year, month, day));
      const dayEvents = eventMap[isoDate] || [];
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
        <span class="day-number">${day}</span>
        <span class="day-count">${dayEvents.length ? `${dayEvents.length} 筆` : "無資料"}</span>
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
      renderEmptyState(selectedDateList, "這一天目前沒有行程。");
      return;
    }

    renderEventCards(selectedDateList, dayEvents);
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

  logoutButton.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "./index.html";
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
