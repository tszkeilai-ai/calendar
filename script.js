/*
  手機版月曆記事板
  ------------------------------------------------------------
  這支檔案負責：
  1. 初始化 Supabase 連線
  2. 處理登入 / 註冊
  3. 管理頁的篩選、列表、新增、修改、刪除
  4. 月曆頁的月份顯示、日期詳情與 Modal 快速新增 / 修改
*/

const SUPABASE_URL = "https://ppdblmxzyuacswjfftei.supabase.co";
const SUPABASE_ANON_KEY =
  "sb_publishable_tsCRBSYpSzq9iPW2wQCRPQ_eMIKzbjf";
const EVENTS_TABLE = "calendar_events";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (selector) => document.querySelector(selector);
const currentPage = document.body.dataset.page;

const modalState = {
  isOpen: false,
  mode: "create",
  editingEntryId: null,
  refresh: null,
  statusElement: null,
  focusReturn: null,
};

function getErrorMessage(error, fallbackText) {
  return error?.message || fallbackText;
}

function formatDateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayISO() {
  return formatDateToISO(new Date());
}

function formatTimeToHM(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatMonthTitle(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function formatDateLabel(isoDate) {
  const [year, month, day] = String(isoDate || "").split("-");
  if (!year || !month || !day) return "未指定日期";
  return `${year}/${month}/${day}`;
}

function formatMonthLabel(monthValue) {
  const [year, month] = String(monthValue || "").split("-");
  if (!year || !month) return "全部";
  return `${year}/${month}`;
}

function formatTimeLabel(timeValue = "") {
  return String(timeValue || "").slice(0, 5);
}

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

function isEmojiToken(value = "") {
  const token = String(value || "");
  if (!token) return false;

  return /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3|\u200D|\uFE0F)/u.test(token);
}

const FALLBACK_EMOJI_INPUT_REGEX =
  /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;

function normalizeEmojiText(value = "", maxCount = 1) {
  const normalized = String(value || "").trim();
  if (!normalized || /^#([0-9a-fA-F]{6})$/.test(normalized)) return "";
  return splitGraphemes(normalized).filter(isEmojiToken).slice(0, maxCount).join("");
}

function sanitizeSingleEmojiInput(value = "") {
  const normalizedEmoji = normalizeEmojiText(value, 1);
  if (normalizedEmoji) return normalizedEmoji;

  const matchedEmoji = String(value || "").match(FALLBACK_EMOJI_INPUT_REGEX);
  return matchedEmoji?.length ? normalizeEmojiText(matchedEmoji[0], 1) : "";
}

function collectDayEmojiTokens(events, maxCount = 4) {
  return events
    .map((event) => normalizeEmojiText(event.color, 1))
    .filter(Boolean)
    .slice(0, maxCount);
}

function isSameMonth(isoDate, dateObj) {
  const [year, month] = String(isoDate || "").split("-");
  if (!year || !month) return false;

  return Number(year) === dateObj.getFullYear() && Number(month) === dateObj.getMonth() + 1;
}

function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.classList.remove("is-error", "is-success");

  if (type === "error") element.classList.add("is-error");
  if (type === "success") element.classList.add("is-success");
}

function renderEmptyState(targetElement, message) {
  if (!targetElement) return;
  targetElement.innerHTML = `
    <li class="entry-item">
      <p class="entry-note">${escapeHtml(message)}</p>
    </li>
  `;
}

function renderEmptyActionState(targetElement, isoDate) {
  if (!targetElement) return;

  targetElement.innerHTML = `
    <li class="entry-item">
      <p class="entry-note">
        ${escapeHtml(formatDateLabel(isoDate))} 目前沒有記事，請點上方「新增今天記事」建立。
      </p>
    </li>
  `;
}

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
                    刪除
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
      button.addEventListener("click", () => onEdit(button.dataset.editId, button));
    });
  }

  if (editable && typeof onDelete === "function") {
    targetElement.querySelectorAll("[data-delete-id]").forEach((button) => {
      button.addEventListener("click", () => onDelete(button.dataset.deleteId));
    });
  }

  if (quickEdit && typeof onQuickEdit === "function") {
    targetElement.querySelectorAll("[data-quick-edit-id]").forEach((button) => {
      button.addEventListener("click", () => onQuickEdit(button.dataset.quickEditId, button));
    });
  }
}

async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabaseClient.auth.getUser();

  if (error) throw error;
  return user;
}

async function fetchEventsByDate(userId, isoDate) {
  const { data, error } = await supabaseClient
    .from(EVENTS_TABLE)
    .select("id,user_id,event_date,event_time,title,description,color")
    .eq("user_id", userId)
    .eq("event_date", isoDate)
    .order("event_time", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchEventsByMonth(userId, monthValue) {
  const [year, month] = String(monthValue).split("-").map(Number);
  const firstDate = formatDateToISO(new Date(year, month - 1, 1));
  const lastDate = formatDateToISO(new Date(year, month, 0));

  const { data, error } = await supabaseClient
    .from(EVENTS_TABLE)
    .select("id,user_id,event_date,event_time,title,description,color")
    .eq("user_id", userId)
    .gte("event_date", firstDate)
    .lte("event_date", lastDate)
    .order("event_date", { ascending: true })
    .order("event_time", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchEventsFromDate(userId, startDate) {
  const { data, error } = await supabaseClient
    .from(EVENTS_TABLE)
    .select("id,user_id,event_date,event_time,title,description,color")
    .eq("user_id", userId)
    .gte("event_date", startDate)
    .order("event_date", { ascending: true })
    .order("event_time", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function deleteEventById(entryId, userId) {
  const { error } = await supabaseClient
    .from(EVENTS_TABLE)
    .delete()
    .eq("id", entryId)
    .eq("user_id", userId);

  if (error) throw error;
}

async function signOutUser({ statusElement = null, redirectTo = null } = {}) {
  try {
    setStatus(statusElement, "登出中...");

    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;

    setStatus(statusElement, "已登出。", "success");

    if (redirectTo) {
      window.location.href = redirectTo;
    }
  } catch (error) {
    setStatus(statusElement, getErrorMessage(error, "登出失敗，請稍後再試。"), "error");
  }
}

function initEventModal() {
  const modal = $("#event-modal");
  if (!modal) return;

  const modalTitle = $("#modal-title");
  const modalSubtitle = $("#modal-subtitle");
  const modalForm = $("#event-form");
  const modalDate = $("#modal-date");
  const modalTime = $("#modal-time");
  const modalTitleInput = $("#modal-title-input");
  const modalEmoji = $("#modal-emoji");
  const modalDescription = $("#modal-description");
  const modalStatus = $("#modal-status");
  const modalSubmitButton = $("#modal-submit-button");
  const modalDeleteButton = $("#modal-delete-button");
  const closeButton = $("#modal-close-button");
  const cancelButton = $("#modal-cancel-button");

  function syncDeleteButtonVisibility(mode = "create") {
    if (!modalDeleteButton) return;
    modalDeleteButton.style.display = mode === "edit" ? "block" : "none";
  }

  function resetModalForm() {
    modalForm.reset();
    modalState.mode = "create";
    modalState.editingEntryId = null;
    modalState.refresh = null;
    modalState.statusElement = null;
    modalState.focusReturn = null;
    if (modalEmoji) {
      modalEmoji.value = "";
    }
    syncDeleteButtonVisibility("create");
    setStatus(modalStatus, "");
  }

  function closeEventModal({ restoreFocus = true } = {}) {
    if (!modalState.isOpen) return;

    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    modalState.isOpen = false;

    const focusTarget = modalState.focusReturn;
    resetModalForm();

    if (restoreFocus && focusTarget && typeof focusTarget.focus === "function") {
      window.requestAnimationFrame(() => focusTarget.focus());
    }
  }

  window.openEventModal = function openEventModal(config = {}) {
    const {
      mode = "create",
      entry = null,
      defaultDate = formatDateToISO(new Date()),
      defaultTime = formatTimeToHM(new Date()),
      title = mode === "edit" ? "修改記事" : "新增記事",
      subtitle = "",
      submitLabel = mode === "edit" ? "儲存修改" : "儲存",
      refresh = null,
      statusElement = null,
      focusReturn = null,
    } = config;

    modalState.mode = mode;
    modalState.editingEntryId = entry?.id || null;
    modalState.refresh = refresh;
    modalState.statusElement = statusElement;
    modalState.focusReturn = focusReturn;
    modalState.isOpen = true;

    modalTitle.textContent = title;
    if (modalSubtitle) {
      modalSubtitle.textContent = subtitle || "";
    }
    modalSubmitButton.textContent = submitLabel;
    syncDeleteButtonVisibility(mode);

    modalDate.value = entry?.event_date || defaultDate;
    modalTime.value = formatTimeLabel(entry?.event_time || defaultTime);
    modalTitleInput.value = entry?.title || "";
    modalEmoji.value = sanitizeSingleEmojiInput(entry?.color || "");
    modalDescription.value = entry?.description || "";
    setStatus(modalStatus, "");

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    window.requestAnimationFrame(() => {
      (entry ? modalTitleInput : modalDate)?.focus();
    });
  };

  modal.querySelector("[data-modal-close]")?.addEventListener("click", () => {
    closeEventModal();
  });

  closeButton?.addEventListener("click", () => {
    closeEventModal();
  });

  cancelButton?.addEventListener("click", () => {
    closeEventModal();
  });

  modalDeleteButton?.addEventListener("click", async () => {
    if (modalState.mode !== "edit" || !modalState.editingEntryId) return;

    const shouldDelete = window.confirm("確定要刪除此筆記事嗎？");
    if (!shouldDelete) return;

    try {
      setStatus(modalStatus, "正在刪除記事...");

      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");

      const refresh = modalState.refresh;
      const pageStatusElement = modalState.statusElement;

      await deleteEventById(modalState.editingEntryId, user.id);
      closeEventModal({ restoreFocus: false });

      try {
        if (typeof refresh === "function") {
          await refresh();
        }

        setStatus(pageStatusElement, "記事已刪除，畫面已即時更新。", "success");
      } catch (refreshError) {
        setStatus(
          pageStatusElement,
          `記事已刪除，但重整畫面失敗：${getErrorMessage(refreshError, "請手動重新整理畫面。")}`,
          "error"
        );
      }
    } catch (error) {
      setStatus(modalStatus, getErrorMessage(error, "刪除失敗，請稍後再試。"), "error");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalState.isOpen) {
      closeEventModal();
    }
  });

  modalEmoji?.addEventListener("input", () => {
    modalEmoji.value = sanitizeSingleEmojiInput(modalEmoji.value);
  });

  modalForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const sanitizedEmoji = sanitizeSingleEmojiInput(modalEmoji.value);
    modalEmoji.value = sanitizedEmoji;

    if (!modalDate.value || !modalTime.value || !modalTitleInput.value.trim() || !sanitizedEmoji) {
      setStatus(modalStatus, "請完整填寫日期、時間、主題與 1 個 Emoji。", "error");
      return;
    }

    try {
      setStatus(modalStatus, modalState.mode === "edit" ? "正在儲存修改..." : "正在新增記事...");

      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");

      const payload = {
        user_id: user.id,
        event_date: modalDate.value,
        event_time: modalTime.value,
        title: modalTitleInput.value.trim(),
        description: modalDescription.value.trim(),
        color: sanitizedEmoji,
      };

      let savedEntry = null;

      if (modalState.mode === "edit" && modalState.editingEntryId) {
        const { data, error } = await supabaseClient
          .from(EVENTS_TABLE)
          .update(payload)
          .eq("id", modalState.editingEntryId)
          .eq("user_id", user.id)
          .select("id,user_id,event_date,event_time,title,description,color")
          .single();

        if (error) throw error;
        savedEntry = data;
      } else {
        const { data, error } = await supabaseClient
          .from(EVENTS_TABLE)
          .insert(payload)
          .select("id,user_id,event_date,event_time,title,description,color")
          .single();

        if (error) throw error;
        savedEntry = data;
      }

      const currentMode = modalState.mode;
      const refresh = modalState.refresh;
      const pageStatusElement = modalState.statusElement;

      closeEventModal({ restoreFocus: false });

      try {
        if (typeof refresh === "function") {
          await refresh(savedEntry);
        }

        setStatus(
          pageStatusElement,
          currentMode === "edit" ? "記事已更新，畫面已即時同步。" : "記事已新增，畫面已即時更新。",
          "success"
        );
      } catch (refreshError) {
        setStatus(
          pageStatusElement,
          `資料已儲存，但重整畫面失敗：${getErrorMessage(refreshError, "請手動重新整理畫面。")}`,
          "error"
        );
      }
    } catch (error) {
      setStatus(modalStatus, getErrorMessage(error, "儲存失敗，請稍後再試。"), "error");
    }
  });

  window.closeEventModal = closeEventModal;
}

let authMode = "login";

async function initIndexPage() {
  const authSection = $("#auth-section");
  const appSection = $("#app-section");
  const authForm = $("#auth-form");
  const authMessage = $("#auth-message");
  const authSubmitButton = $("#auth-submit-button");
  const loginTab = $("#login-tab");
  const registerTab = $("#register-tab");
  const entryList = $("#entry-list");
  const listStatus = $("#list-status");
  const filterDateInput = $("#filter-date");
  const filterMonthInput = $("#filter-month");
  const clearFilterButton = $("#clear-filter-button");
  const currentDateLabel = $("#current-date-label");
  const openCreateModalButton = $("#open-create-modal-button");
  const logoutButton = $("#logout-button");

  let filterDate = "";
  let filterMonth = "";
  let latestRenderedEntries = [];

  function getCurrentFilterStartDate() {
    if (filterDate) return filterDate;
    if (filterMonth) return `${filterMonth}-01`;
    return getTodayISO();
  }

  function switchAuthMode(mode) {
    authMode = mode;
    loginTab.classList.toggle("is-active", mode === "login");
    registerTab.classList.toggle("is-active", mode === "register");
    authSubmitButton.textContent = mode === "login" ? "登入" : "註冊";

    setStatus(
      authMessage,
      mode === "login" ? "請輸入帳號密碼登入。" : "建立新帳號後即可開始使用。"
    );
  }

  function updateCurrentDateLabel() {
    if (filterDate) {
      currentDateLabel.textContent = `${formatDateLabel(filterDate)} 起`;
      return;
    }

    if (filterMonth) {
      currentDateLabel.textContent = `${formatDateLabel(`${filterMonth}-01`)} 起`;
      return;
    }

    currentDateLabel.textContent = "今天起";
  }

  async function refreshEntries() {
    try {
      updateCurrentDateLabel();
      setStatus(listStatus, "正在讀取記事資料...");

      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");

      latestRenderedEntries = await fetchEventsFromDate(user.id, getCurrentFilterStartDate());

      renderEventCards(entryList, latestRenderedEntries, {
        editable: true,
        showDate: true,
        onEdit: startEditing,
        onDelete: handleDeleteEntry,
      });

      if (!latestRenderedEntries.length) {
        setStatus(listStatus, "目前沒有符合條件的記事。");
        return;
      }

      if (filterDate) {
        setStatus(listStatus, `已載入 ${formatDateLabel(filterDate)} 起的記事。`, "success");
        return;
      }

      if (filterMonth) {
        setStatus(listStatus, `已載入 ${formatDateLabel(`${filterMonth}-01`)} 起的記事。`, "success");
        return;
      }

      setStatus(listStatus, "已載入今天起到未來的記事。", "success");
    } catch (error) {
      latestRenderedEntries = [];
      renderEmptyState(entryList, "目前沒有資料。");
      setStatus(
        listStatus,
        `讀取失敗：${getErrorMessage(
          error,
          "暫時無法讀取資料，請確認 Supabase 資料表與權限設定。"
        )}`,
        "error"
      );
    }
  }

  function startEditing(entryId, triggerButton) {
    const entry = latestRenderedEntries.find((item) => item.id === entryId);
    if (!entry || typeof window.openEventModal !== "function") return;

    window.openEventModal({
      mode: "edit",
      entry,
      title: "修改記事",
      submitLabel: "儲存修改",
      refresh: refreshEntries,
      statusElement: listStatus,
      focusReturn: triggerButton,
    });
  }

  async function handleDeleteEntry(entryId) {
    const targetEntry = latestRenderedEntries.find((item) => item.id === entryId);
    if (!targetEntry) return;

    const shouldDelete = window.confirm(
      `確定要刪除 ${formatDateLabel(targetEntry.event_date)} ${formatTimeLabel(
        targetEntry.event_time
      )} 的「${targetEntry.title}」嗎？`
    );

    if (!shouldDelete) return;

    try {
      setStatus(listStatus, "正在刪除記事...");

      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");

      await deleteEventById(entryId, user.id);
      await refreshEntries();
      setStatus(listStatus, "記事已刪除。", "success");
    } catch (error) {
      setStatus(
        listStatus,
        getErrorMessage(error, "刪除失敗，請稍後再試或檢查資料表權限。"),
        "error"
      );
    }
  }

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

  authForm?.addEventListener("submit", async (event) => {
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
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setStatus(authMessage, "登入成功。", "success");
      } else {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;

        if (!data.session) {
          setStatus(authMessage, "註冊成功，請先到信箱完成驗證後再登入。", "success");
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

  loginTab?.addEventListener("click", () => switchAuthMode("login"));
  registerTab?.addEventListener("click", () => switchAuthMode("register"));

  filterDateInput?.addEventListener("change", async (event) => {
    filterDate = event.target.value || "";
    if (filterDate) {
      filterMonth = "";
      filterMonthInput.value = "";
    }
    await refreshEntries();
  });

  filterMonthInput?.addEventListener("change", async (event) => {
    filterMonth = event.target.value || "";
    if (filterMonth) {
      filterDate = "";
      filterDateInput.value = "";
    }
    await refreshEntries();
  });

  clearFilterButton?.addEventListener("click", async () => {
    filterDate = "";
    filterMonth = "";
    filterDateInput.value = "";
    filterMonthInput.value = "";
    await refreshEntries();
  });

  openCreateModalButton?.addEventListener("click", () => {
    if (typeof window.openEventModal !== "function") return;

    const fallbackDate = filterDate || (filterMonth ? `${filterMonth}-01` : formatDateToISO(new Date()));

    window.openEventModal({
      mode: "create",
      defaultDate: fallbackDate,
      defaultTime: formatTimeToHM(new Date()),
      title: "新增記事",
      submitLabel: "儲存",
      refresh: refreshEntries,
      statusElement: listStatus,
      focusReturn: openCreateModalButton,
    });
  });

  logoutButton?.addEventListener("click", async () => {
    await signOutUser({ statusElement: listStatus });
  });

  supabaseClient.auth.onAuthStateChange(async () => {
    await togglePageBySession();
  });

  switchAuthMode("login");
  updateCurrentDateLabel();
  await togglePageBySession();
}

let calendarCurrentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarEvents = [];
let selectedCalendarDate = formatDateToISO(new Date());

async function initCalendarPage() {
  const monthTitle = $("#calendar-month-title");
  const calendarGrid = $("#calendar-grid");
  const selectedDateTitle = $("#selected-date-title");
  const selectedDateChip = $("#selected-date-chip");
  const selectedDateList = $("#selected-date-list");
  const calendarStatus = $("#calendar-status");
  const prevMonthButton = $("#prev-month-button");
  const currentMonthButton = $("#current-month-button");
  const nextMonthButton = $("#next-month-button");
  const openCreateButton = $("#calendar-open-create-button");
  const calendarLogoutButton = $("#calendar-logout-button");

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = "./index.html";
    return;
  }

  function buildEventMap() {
    return calendarEvents.reduce((map, event) => {
      if (!map[event.event_date]) {
        map[event.event_date] = [];
      }
      map[event.event_date].push(event);
      return map;
    }, {});
  }

  async function refreshCurrentMonth(savedEntry = null) {
    if (savedEntry?.event_date) {
      selectedCalendarDate = savedEntry.event_date;
    }

    await loadMonthEvents(calendarCurrentMonth);
  }

  function openCreateModalForDate(isoDate, focusReturn = null) {
    if (typeof window.openEventModal !== "function") return;

    window.openEventModal({
      mode: "create",
      defaultDate: isoDate,
      defaultTime: formatTimeToHM(new Date()),
      title: `新增 ${formatDateLabel(isoDate)} 記事`,
      submitLabel: "儲存",
      refresh: refreshCurrentMonth,
      statusElement: calendarStatus,
      focusReturn,
    });
  }

  function openEditModalForEntry(entryId, focusReturn = null) {
    const entry = calendarEvents.find((item) => item.id === entryId);
    if (!entry || typeof window.openEventModal !== "function") return;

    window.openEventModal({
      mode: "edit",
      entry,
      title: `修改 ${formatDateLabel(entry.event_date)} 記事`,
      submitLabel: "儲存修改",
      refresh: refreshCurrentMonth,
      statusElement: calendarStatus,
      focusReturn,
    });
  }

  function renderCalendar(baseDate) {
    const eventMap = buildEventMap();
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();
    const leadingBlankDays = firstDay.getDay();
    const todayISO = formatDateToISO(new Date());

    monthTitle.textContent = formatMonthTitle(baseDate);
    calendarGrid.innerHTML = "";

    for (let i = 0; i < leadingBlankDays; i += 1) {
      const blankCell = document.createElement("div");
      blankCell.className = "calendar-day is-muted";
      blankCell.setAttribute("aria-hidden", "true");
      calendarGrid.appendChild(blankCell);
    }

    for (let day = 1; day <= totalDays; day += 1) {
      const isoDate = formatDateToISO(new Date(year, month, day));
      const dayEvents = eventMap[isoDate] || [];
      const emojiTokens = collectDayEmojiTokens(dayEvents, 4);
      const extraCount = Math.max(dayEvents.length - 4, 0);
      const dayButton = document.createElement("button");

      dayButton.type = "button";
      dayButton.className = "calendar-day";

      if (dayEvents.length) {
        dayButton.classList.add("has-events");
      }

      if (isoDate === selectedCalendarDate) {
        dayButton.classList.add("is-selected");
      }

      if (isoDate === todayISO) {
        dayButton.classList.add("is-today");
      }

      dayButton.innerHTML = `
        <div class="calendar-day-header">
          <span class="day-number">${day}</span>
        </div>
        <div class="calendar-day-footer">
          ${
            emojiTokens.length
              ? `
                <div class="event-emojis-box">
                  <div class="event-emojis" aria-label="當天主題 Emoji">
                    ${emojiTokens
                      .map((emoji) => `<span class="event-emoji">${escapeHtml(emoji)}</span>`)
                      .join("")}
                  </div>
                </div>
              `
              : ""
          }
        </div>
        ${
          extraCount > 0
            ? `<span class="calendar-day-more" aria-label="另外還有 ${extraCount} 筆記事">+${extraCount}</span>`
            : ""
        }
      `;

      dayButton.addEventListener("click", () => {
        selectedCalendarDate = isoDate;
        renderCalendar(baseDate);
        renderSelectedDateDetails(isoDate);
      });

      calendarGrid.appendChild(dayButton);
    }
  }

  function renderSelectedDateDetails(isoDate) {
    const dayEvents = calendarEvents.filter((event) => event.event_date === isoDate);
    selectedDateTitle.textContent = `${formatDateLabel(isoDate)} 行程詳情`;
    selectedDateChip.textContent = formatDateLabel(isoDate);

    if (!dayEvents.length) {
      renderEmptyActionState(selectedDateList, isoDate);
      return;
    }

    renderEventCards(selectedDateList, dayEvents, {
      quickEdit: true,
      onQuickEdit: openEditModalForEntry,
    });
  }

  async function loadMonthEvents(baseDate) {
    try {
      setStatus(calendarStatus, "正在載入月曆資料...");

      const user = await getCurrentUser();
      if (!user) throw new Error("登入狀態已失效，請重新登入。");

      const monthValue = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, "0")}`;
      calendarEvents = await fetchEventsByMonth(user.id, monthValue);

      if (!isSameMonth(selectedCalendarDate, baseDate)) {
        const todayISO = formatDateToISO(new Date());
        selectedCalendarDate = isSameMonth(todayISO, baseDate)
          ? todayISO
          : formatDateToISO(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));
      }

      renderCalendar(baseDate);
      renderSelectedDateDetails(selectedCalendarDate);
      setStatus(calendarStatus, `${formatMonthTitle(baseDate)}資料已載入。`, "success");
    } catch (error) {
      calendarGrid.innerHTML = "";
      selectedDateTitle.textContent = "資料載入失敗";
      selectedDateChip.textContent = "讀取失敗";
      renderEmptyState(selectedDateList, "無法載入該月份資料，請確認資料表與權限設定。");
      setStatus(calendarStatus, getErrorMessage(error, "讀取月曆資料失敗。"), "error");
    }
  }

  prevMonthButton?.addEventListener("click", async () => {
    calendarCurrentMonth = new Date(
      calendarCurrentMonth.getFullYear(),
      calendarCurrentMonth.getMonth() - 1,
      1
    );
    await loadMonthEvents(calendarCurrentMonth);
  });

  nextMonthButton?.addEventListener("click", async () => {
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

  openCreateButton?.addEventListener("click", () => {
    openCreateModalForDate(selectedCalendarDate || formatDateToISO(new Date()), openCreateButton);
  });

  calendarLogoutButton?.addEventListener("click", async () => {
    await signOutUser({ statusElement: calendarStatus, redirectTo: "./index.html" });
  });

  await loadMonthEvents(calendarCurrentMonth);
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    initEventModal();

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
