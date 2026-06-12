const SUPABASE_URL = "https://ppdblmxzyuacswjfftei.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tsCRBSYpSzq9iPW2wQCRPQ_eMIKzbjf";
const TABLE_NAME = "calendar_events";
const DEFAULT_COLOR = "#4f46e5";
const DEFAULT_CATEGORY = "";
const PAGE_TYPE = document.body.dataset.page || "manage";

const authScreen = document.querySelector("#authScreen");
const appScreen = document.querySelector("#appScreen");
const authMessage = document.querySelector("#authMessage");
const loginForm = document.querySelector("#loginForm");
const registerForm = document.querySelector("#registerForm");
const logoutButton = document.querySelector("#logoutButton");
const userEmail = document.querySelector("#userEmail");
const syncStatus = document.querySelector("#syncStatus");

const entryTableBody = document.querySelector("#entryTableBody");
const entryRowTemplate = document.querySelector("#entryRowTemplate");
const filterSummary = document.querySelector("#filterSummary");
const saveButton = document.querySelector("#saveButton");
const sampleButton = document.querySelector("#sampleButton");
const clearButton = document.querySelector("#clearButton");
const filterExactDate = document.querySelector("#filterExactDate");
const filterStartDate = document.querySelector("#filterStartDate");
const filterEndDate = document.querySelector("#filterEndDate");
const resetFilterButton = document.querySelector("#resetFilterButton");
const toggleFilterButton = document.querySelector("#toggleFilterButton");
const filterPanel = document.querySelector("#filterPanel");
const quickAddForm = document.querySelector("#quickAddForm");
const quickTimeInput = document.querySelector("#quickTimeInput");
const quickCategoryInput = document.querySelector("#quickCategoryInput");
const quickNoteInput = document.querySelector("#quickNoteInput");
const quickAddTarget = document.querySelector("#quickAddTarget");

const calendarGrid = document.querySelector("#calendarGrid");
const calendarTitle = document.querySelector("#calendarTitle");
const prevMonthButton = document.querySelector("#prevMonthButton");
const nextMonthButton = document.querySelector("#nextMonthButton");
const todayButton = document.querySelector("#todayButton");
const selectedDateTitle = document.querySelector("#selectedDateTitle");
const selectedDateEvents = document.querySelector("#selectedDateEvents");

const state = {
  supabase: null,
  session: null,
  user: null,
  entries: [],
  selectedDate: PAGE_TYPE === "calendar" ? formatDate(new Date()) : "",
  showFilterPanel: false,
  filters: {
    exactDate: "",
    startDate: "",
    endDate: ""
  },
  currentMonth: startOfMonth(new Date()),
  realtimeChannel: null,
  pendingTimers: new Map()
};

bootstrap().catch((error) => {
  console.error(error);
  showAuthMessage("初始化失敗，請檢查 Supabase 設定。");
});

async function bootstrap() {
  if (!window.supabase?.createClient) {
    throw new Error("Supabase SDK 未成功載入。");
  }

  state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  bindAuthEvents();
  bindManageEvents();
  bindCalendarEvents();
  bindResponsiveEvents();

  const { data, error } = await state.supabase.auth.getSession();
  if (error) throw error;

  await handleSessionChange(data.session);

  state.supabase.auth.onAuthStateChange(async (_event, session) => {
    await handleSessionChange(session);
  });
}

function bindAuthEvents() {
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(loginForm);
      const email = String(formData.get("loginEmail") || document.querySelector("#loginEmail")?.value || "").trim();
      const password = String(formData.get("loginPassword") || document.querySelector("#loginPassword")?.value || "");

      try {
        showAuthMessage("登入中...");
        const { error } = await state.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showAuthMessage("登入成功，正在載入雲端資料。");
      } catch (error) {
        showAuthMessage(`登入失敗：${error.message}`);
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(registerForm);
      const email = String(formData.get("registerEmail") || document.querySelector("#registerEmail")?.value || "").trim();
      const password = String(formData.get("registerPassword") || document.querySelector("#registerPassword")?.value || "");

      try {
        showAuthMessage("註冊中...");
        const { data, error } = await state.supabase.auth.signUp({ email, password });
        if (error) throw error;

        if (data.session) {
          showAuthMessage("註冊成功，已經自動登入。");
          return;
        }

        showAuthMessage("註冊成功，請到 Email 收信完成驗證，再返回登入。");
      } catch (error) {
        showAuthMessage(`註冊失敗：${error.message}`);
      }
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        await state.supabase.auth.signOut();
      } catch (error) {
        updateSyncStatus(`登出失敗：${error.message}`, true);
      }
    });
  }
}

function bindManageEvents() {
  if (quickAddForm) {
    quickAddForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await handleQuickAdd();
    });
  }

  if (saveButton) {
    saveButton.addEventListener("click", async () => {
      try {
        await saveAllEntries();
        updateSyncStatus("已完成即時同步。");
      } catch (error) {
        updateSyncStatus(`同步失敗：${error.message}`, true);
      }
    });
  }

  if (sampleButton) {
    sampleButton.addEventListener("click", () => {
      const samples = [
        createDraftEntry({ date: todayOffset(1), time: "09:00", category: "工作", note: "提交報告", color: "#2563eb" }),
        createDraftEntry({ date: todayOffset(2), time: "19:30", category: "生日", note: "家人生日晚飯", color: "#db2777" }),
        createDraftEntry({ date: todayOffset(4), time: "08:00", category: "假期", note: "短途旅行出發", color: "#16a34a" }),
        createDraftEntry({ date: todayOffset(7), time: "20:15", category: "娛樂", note: "睇戲", color: "#ea580c" })
      ];
      state.entries = [...state.entries.filter((entry) => !entry.isDraft || hasMeaningfulContent(entry)), ...samples];
      renderTable();
      renderCalendar();
      renderQuickAddTarget();
      updateSyncStatus("示例已加入，按「立即同步」或直接修改日期後會上載。");
    });
  }

  if (clearButton) {
    clearButton.addEventListener("click", async () => {
      const shouldClear = window.confirm("確定清空你帳號下全部日曆資料？");
      if (!shouldClear) return;

      try {
        updateSyncStatus("清空資料中...");
        const persistedIds = state.entries.filter((entry) => !entry.isDraft).map((entry) => entry.id);
        if (persistedIds.length > 0) {
          const { error } = await state.supabase.from(TABLE_NAME).delete().in("id", persistedIds);
          if (error) throw error;
        }
        state.entries = [];
        renderTable();
        renderCalendar();
        renderQuickAddTarget();
        updateSyncStatus("已清空你帳號下的日曆資料。");
      } catch (error) {
        updateSyncStatus(`清空失敗：${error.message}`, true);
      }
    });
  }

  [filterExactDate, filterStartDate, filterEndDate].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", handleFilterChange);
  });

  if (resetFilterButton) {
    resetFilterButton.addEventListener("click", () => {
      state.filters = { exactDate: "", startDate: "", endDate: "" };
      if (filterExactDate) filterExactDate.value = "";
      if (filterStartDate) filterStartDate.value = "";
      if (filterEndDate) filterEndDate.value = "";
      setFilterPanelOpen(false);
      renderTable();
      renderQuickAddTarget();
    });
  }

  if (toggleFilterButton) {
    toggleFilterButton.addEventListener("click", () => {
      setFilterPanelOpen(!state.showFilterPanel);
    });
  }
}

function bindCalendarEvents() {
  if (prevMonthButton) {
    prevMonthButton.addEventListener("click", () => {
      state.currentMonth = startOfMonth(new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1));
      renderCalendar();
    });
  }

  if (nextMonthButton) {
    nextMonthButton.addEventListener("click", () => {
      state.currentMonth = startOfMonth(new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1));
      renderCalendar();
    });
  }

  if (todayButton) {
    todayButton.addEventListener("click", () => {
      state.currentMonth = startOfMonth(new Date());
      renderCalendar();
    });
  }
}

function bindResponsiveEvents() {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderCalendar();
    }, 120);
  });
}

async function handleSessionChange(session) {
  state.session = session;
  state.user = session?.user || null;
  toggleScreens(Boolean(state.user));
  cleanupRealtimeChannel();

  if (!state.user) {
    state.entries = [];
    if (PAGE_TYPE === "calendar") {
      state.selectedDate = formatDate(new Date());
    }
    renderTable();
    renderCalendar();
    renderSelectedDateEvents();
    renderQuickAddTarget();
    updateSyncStatus("未登入。");
    return;
  }

  if (userEmail) {
    userEmail.textContent = state.user.email || "已登入";
  }

  await loadEntriesFromCloud();
  subscribeToRealtime();
}

function toggleScreens(isLoggedIn) {
  if (authScreen) authScreen.hidden = isLoggedIn;
  if (appScreen) appScreen.hidden = !isLoggedIn;
}

function showAuthMessage(message) {
  if (!authMessage) return;
  authMessage.hidden = false;
  authMessage.textContent = message;
}

function updateSyncStatus(message, isError = false) {
  if (!syncStatus) return;
  syncStatus.textContent = message;
  syncStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

async function loadEntriesFromCloud() {
  if (!state.user) return;

  updateSyncStatus("同步雲端資料中...");

  const draftEntries = state.entries.filter((entry) => entry.isDraft && hasMeaningfulContent(entry));
  const { data, error } = await state.supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("user_id", state.user.id)
    .order("event_date", { ascending: true })
    .order("event_time", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    updateSyncStatus(`讀取失敗：${error.message}`, true);
    return;
  }

  const cloudEntries = (data || []).map(mapDbRowToEntry);
  state.entries = [...cloudEntries, ...draftEntries];

  if (PAGE_TYPE === "calendar" && !state.selectedDate) {
    state.selectedDate = formatDate(new Date());
  }

  renderTable();
  renderCalendar();
  renderSelectedDateEvents();
  renderQuickAddTarget();
  updateSyncStatus("雲端資料已同步。");
}

function subscribeToRealtime() {
  if (!state.user) return;

  state.realtimeChannel = state.supabase
    .channel(`calendar-events-${state.user.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: TABLE_NAME,
        filter: `user_id=eq.${state.user.id}`
      },
      async () => {
        await loadEntriesFromCloud();
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        updateSyncStatus("即時同步已啟動。");
      }
    });
}

function cleanupRealtimeChannel() {
  if (state.realtimeChannel) {
    state.supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
}

function renderTable() {
  if (!entryTableBody || !entryRowTemplate) return;

  const filteredEntries = getFilteredEntries();
  entryTableBody.innerHTML = "";

  if (filteredEntries.length === 0) {
    entryTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state-cell">目前沒有符合篩選條件的資料。</td>
      </tr>
    `;
    updateFilterSummary(0);
    return;
  }

  filteredEntries.forEach((entry) => {
    const rowFragment = entryRowTemplate.content.cloneNode(true);
    const row = rowFragment.querySelector("tr");
    const dateInput = row.querySelector(".entry-date");
    const timeInput = row.querySelector(".entry-time");
    const categoryInput = row.querySelector(".entry-category");
    const noteInput = row.querySelector(".entry-note");
    const colorInput = row.querySelector(".entry-color");
    const deleteButton = row.querySelector(".delete-row-button");

    dateInput.value = entry.date || "";
    timeInput.value = entry.time || "";
    categoryInput.value = entry.category || "";
    noteInput.value = entry.note || "";
    colorInput.value = entry.color || DEFAULT_COLOR;

    dateInput.addEventListener("input", (event) => updateEntry(entry.id, "date", event.target.value));
    timeInput.addEventListener("input", (event) => updateEntry(entry.id, "time", event.target.value));
    categoryInput.addEventListener("input", (event) => updateEntry(entry.id, "category", event.target.value));
    noteInput.addEventListener("input", (event) => updateEntry(entry.id, "note", event.target.value));
    colorInput.addEventListener("input", (event) => updateEntry(entry.id, "color", event.target.value));
    deleteButton.addEventListener("click", async () => {
      await deleteEntry(entry.id);
    });

    entryTableBody.appendChild(rowFragment);
  });

  updateFilterSummary(filteredEntries.filter((entry) => hasMeaningfulContent(entry)).length);
}

function renderCalendar() {
  if (!calendarGrid || !calendarTitle) return;

  calendarGrid.innerHTML = "";

  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const gridStart = new Date(year, month, 1 - startWeekday);

  calendarTitle.textContent = `${year} 年 ${month + 1} 月`;

  const calendarEntries = state.entries
    .filter((entry) => entry.date && !entry.isDraft)
    .sort(sortEntriesByDateTime);
  const maxVisibleEvents = window.innerWidth <= 720 ? 2 : 3;

  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + index);

    const dateKey = formatDate(cellDate);
    const dayEntries = calendarEntries
      .filter((entry) => entry.date === dateKey)
      .sort(sortEntriesByDateTime);

    const dayCell = document.createElement("article");
    dayCell.className = "calendar-day";
    dayCell.tabIndex = 0;
    dayCell.setAttribute("role", "button");
    dayCell.setAttribute("aria-label", `${dateKey} 的事件`);

    if (cellDate.getMonth() !== month) {
      dayCell.classList.add("other-month");
    }

    if (isSameDate(cellDate, new Date())) {
      dayCell.classList.add("is-today");
    }

    if (state.selectedDate === dateKey) {
      dayCell.classList.add("is-selected");
    }

    const dayHeader = document.createElement("div");
    dayHeader.className = "calendar-day-header";

    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = String(cellDate.getDate());
    dayHeader.appendChild(number);
    dayCell.appendChild(dayHeader);

    const eventList = document.createElement("div");
    eventList.className = "event-list";

    const visibleEntries = dayEntries.slice(0, maxVisibleEvents);

    visibleEntries.forEach((entry) => {
      const chip = document.createElement("div");
      chip.className = "event-chip";
      chip.style.background = entry.color || DEFAULT_COLOR;
      chip.style.color = getReadableTextColor(entry.color || DEFAULT_COLOR);
      chip.title = `${formatDisplayTime(entry.time)} ${entry.category || "未分類"} ${entry.note || ""}`.trim();

      const header = document.createElement("div");
      header.className = "event-chip-header";

      const category = document.createElement("strong");
      category.className = "event-title";
      category.textContent = entry.category || "未分類";

      const time = document.createElement("span");
      time.className = "event-time";
      time.textContent = formatDisplayTime(entry.time);

      const note = document.createElement("span");
      note.className = "event-note";
      note.textContent = entry.note || "沒有備註";

      header.append(category, time);
      chip.append(header, note);
      eventList.appendChild(chip);
    });

    if (dayEntries.length > maxVisibleEvents) {
      const moreIndicator = document.createElement("div");
      moreIndicator.className = "more-events";
      moreIndicator.textContent = `+${dayEntries.length - maxVisibleEvents} 項`;
      eventList.appendChild(moreIndicator);
    }

    dayCell.addEventListener("click", () => handleDateSelection(dateKey));
    dayCell.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleDateSelection(dateKey);
      }
    });

    dayCell.appendChild(eventList);
    calendarGrid.appendChild(dayCell);
  }
}

function handleDateSelection(dateKey) {
  state.selectedDate = dateKey;
  renderCalendar();
  renderSelectedDateEvents();

  if (selectedDateEvents) {
    selectedDateEvents.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderSelectedDateEvents() {
  if (!selectedDateEvents || !selectedDateTitle) return;

  if (!state.selectedDate) {
    selectedDateTitle.textContent = "按一下月曆日期，即可查看當日完整行程。";
    selectedDateEvents.innerHTML = '<p class="empty-detail-message">尚未選擇日期。</p>';
    return;
  }

  const items = state.entries
    .filter((entry) => !entry.isDraft && entry.date === state.selectedDate)
    .sort(sortEntriesByDateTime);

  selectedDateTitle.textContent = `${formatDateForDisplay(state.selectedDate)} 的完整行程`;

  if (items.length === 0) {
    selectedDateEvents.innerHTML = '<p class="empty-detail-message">當日沒有任何事件。</p>';
    return;
  }

  selectedDateEvents.innerHTML = items
    .map((entry) => {
      const textColor = getReadableTextColor(entry.color || DEFAULT_COLOR);
      const timeText = formatDisplayTime(entry.time);
      const noteText = escapeHtml(entry.note || "沒有備註");
      const categoryText = escapeHtml(entry.category || "未分類");
      const badgeStyle = `background:${entry.color || DEFAULT_COLOR};color:${textColor};`;

      return `
        <article class="detail-event-card">
          <div class="detail-event-top">
            <span class="detail-time">${timeText}</span>
            <span class="detail-category" style="${badgeStyle}">${categoryText}</span>
          </div>
          <p class="detail-note">${noteText}</p>
        </article>
      `;
    })
    .join("");
}

async function updateEntry(entryId, key, value) {
  state.entries = state.entries.map((entry) => {
    if (entry.id !== entryId) return entry;
    return { ...entry, [key]: value };
  });

  if (key === "date" && (state.filters.exactDate || state.filters.startDate || state.filters.endDate)) {
    renderTable();
  }
  renderCalendar();
  renderSelectedDateEvents();

  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry || !state.user) return;

  if (!hasRequiredFields(entry)) {
    updateSyncStatus("草稿已更新，補上日期後就可以同步。");
    return;
  }

  scheduleEntrySync(entry.id);
}

function scheduleEntrySync(entryId) {
  const existingTimer = state.pendingTimers.get(entryId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(async () => {
    try {
      await saveEntry(entryId);
      updateSyncStatus("資料已自動同步。");
    } catch (error) {
      updateSyncStatus(`自動同步失敗：${error.message}`, true);
    } finally {
      state.pendingTimers.delete(entryId);
    }
  }, 500);

  state.pendingTimers.set(entryId, timer);
}

async function saveAllEntries() {
  const candidates = state.entries.filter((entry) => hasRequiredFields(entry));
  for (const entry of candidates) {
    await saveEntry(entry.id);
  }
}

async function saveEntry(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry || !state.user || !hasRequiredFields(entry)) return;

  const payload = {
    user_id: state.user.id,
    event_date: entry.date,
    event_time: normalizeTimeForDb(entry.time),
    category: normalizeCategory(entry.category) || "未分類",
    note: entry.note || "",
    color: entry.color || DEFAULT_COLOR
  };

  updateSyncStatus("同步項目中...");

  if (entry.isDraft) {
    const { data, error } = await state.supabase
      .from(TABLE_NAME)
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    state.entries = state.entries.map((item) => {
      if (item.id !== entry.id) return item;
      return mapDbRowToEntry(data);
    });
    renderTable();
    renderCalendar();
    renderSelectedDateEvents();
    return;
  }

  const { error } = await state.supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", entry.id);

  if (error) throw error;
}

async function deleteEntry(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;

  if (entry.isDraft) {
    state.entries = state.entries.filter((item) => item.id !== entryId);
    renderTable();
    renderCalendar();
    renderSelectedDateEvents();
    return;
  }

  try {
    const { error } = await state.supabase.from(TABLE_NAME).delete().eq("id", entry.id);
    if (error) throw error;

    state.entries = state.entries.filter((item) => item.id !== entryId);
    renderTable();
    renderCalendar();
    renderSelectedDateEvents();
    updateSyncStatus("項目已刪除並同步。");
  } catch (error) {
    updateSyncStatus(`刪除失敗：${error.message}`, true);
  }
}

function handleFilterChange() {
  state.filters = {
    exactDate: filterExactDate?.value || "",
    startDate: filterStartDate?.value || "",
    endDate: filterEndDate?.value || ""
  };
  setFilterPanelOpen(hasActiveFilters());
  renderTable();
  renderQuickAddTarget();
}

function getFilteredEntries() {
  return state.entries.filter((entry) => matchesFilter(entry));
}

function matchesFilter(entry) {
  const { exactDate, startDate, endDate } = state.filters;
  const entryDate = entry.date || "";

  if (exactDate) {
    return entryDate === exactDate;
  }

  if (startDate && (!entryDate || entryDate < startDate)) {
    return false;
  }

  if (endDate && (!entryDate || entryDate > endDate)) {
    return false;
  }

  return true;
}

function updateFilterSummary(count) {
  if (!filterSummary) return;

  const hasExactDate = Boolean(state.filters.exactDate);
  const hasRange = Boolean(state.filters.startDate || state.filters.endDate);

  if (hasExactDate) {
    filterSummary.textContent = `現正顯示 ${count} 筆指定日期資料。`;
    return;
  }

  if (hasRange) {
    filterSummary.textContent = `現正顯示 ${count} 筆日期範圍內資料。`;
    return;
  }

  filterSummary.textContent = `現正顯示全部 ${count} 筆資料，可直接像 Excel 一樣逐行輸入，再自動同步。`;
}

async function handleQuickAdd() {
  if (!state.user) return;

  const targetDate = getQuickAddDate();
  const time = quickTimeInput?.value || "";
  const category = normalizeCategory(quickCategoryInput?.value || "");
  const note = quickNoteInput?.value.trim() || "";

  if (!time && !note && !category) {
    updateSyncStatus("請至少輸入主題、時間或備註，再新增資料。", true);
    quickCategoryInput?.focus();
    return;
  }

  const payload = {
    user_id: state.user.id,
    event_date: targetDate,
    event_time: normalizeTimeForDb(time),
    category: category || "未分類",
    note,
    color: DEFAULT_COLOR
  };

  try {
    updateSyncStatus("新增資料中...");
    const { data, error } = await state.supabase
      .from(TABLE_NAME)
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    state.entries = [...state.entries.filter((entry) => entry.id !== data.id), mapDbRowToEntry(data)].sort(sortEntriesByDateTime);
    renderTable();
    renderCalendar();
    renderSelectedDateEvents();
    clearQuickAddForm();
    updateSyncStatus(`已新增到 ${formatDateForDisplay(targetDate)}。`);
  } catch (error) {
    updateSyncStatus(`新增失敗：${error.message}`, true);
  }
}

function clearQuickAddForm() {
  if (quickTimeInput) quickTimeInput.value = "";
  if (quickCategoryInput) quickCategoryInput.value = "";
  if (quickNoteInput) quickNoteInput.value = "";
  quickCategoryInput?.focus();
}

function getQuickAddDate() {
  return state.filters.exactDate || formatDate(new Date());
}

function renderQuickAddTarget() {
  if (!quickAddTarget) return;

  const targetDate = getQuickAddDate();
  const targetText = state.filters.exactDate
    ? `目前會新增到指定日期：${formatDateForDisplay(targetDate)}`
    : `未設定指定日期時，新增項目會自動加入今天：${formatDateForDisplay(targetDate)}`;

  quickAddTarget.textContent = targetText;
}

function hasActiveFilters() {
  return Boolean(state.filters.exactDate || state.filters.startDate || state.filters.endDate);
}

function setFilterPanelOpen(shouldOpen) {
  state.showFilterPanel = shouldOpen;
  if (filterPanel) {
    filterPanel.hidden = !shouldOpen;
  }
  if (toggleFilterButton) {
    toggleFilterButton.setAttribute("aria-expanded", String(shouldOpen));
    toggleFilterButton.textContent = shouldOpen ? "收起搜尋" : "搜尋";
  }
}

function createDraftEntry(initialValues = {}) {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: initialValues.date || "",
    time: initialValues.time || "",
    category: initialValues.category || "",
    note: initialValues.note || "",
    color: initialValues.color || DEFAULT_COLOR,
    isDraft: true
  };
}

function mapDbRowToEntry(row) {
  return {
    id: row.id,
    date: row.event_date,
    time: normalizeTimeFromDb(row.event_time),
    category: row.category || "",
    note: row.note || "",
    color: row.color || DEFAULT_COLOR,
    isDraft: false
  };
}

function hasRequiredFields(entry) {
  return Boolean(entry.date);
}

function hasMeaningfulContent(entry) {
  return Boolean(entry.date || entry.time || entry.note);
}

function normalizeTimeForDb(timeValue) {
  return timeValue ? `${timeValue}:00` : null;
}

function normalizeTimeFromDb(timeValue) {
  if (!timeValue) return "";
  return String(timeValue).slice(0, 5);
}

function formatDisplayTime(timeValue) {
  if (!timeValue) return "全天";
  return timeValue.replace(":", "");
}

function sortEntriesByDateTime(entryA, entryB) {
  const dateCompare = String(entryA.date || "").localeCompare(String(entryB.date || ""));
  if (dateCompare !== 0) return dateCompare;

  return getTimeSortValue(entryA.time) - getTimeSortValue(entryB.time);
}

function getTimeSortValue(timeValue) {
  if (!timeValue) return 9999;
  return Number(timeValue.replace(":", ""));
}

function getReadableTextColor(hexColor) {
  const normalized = String(hexColor || "").replace("#", "");
  if (normalized.length !== 6) return "#ffffff";

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.68 ? "#162033" : "#ffffff";
}

function normalizeCategory(categoryValue) {
  return String(categoryValue || "").trim();
}

function formatDateForDisplay(dateString) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00`);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDate(dateA, dateB) {
  return formatDate(dateA) === formatDate(dateB);
}

function todayOffset(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return formatDate(date);
}
