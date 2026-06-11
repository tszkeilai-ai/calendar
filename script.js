const STORAGE_KEY = "monthly-calendar-board-data";
const DEFAULT_COLOR = "#4f46e5";
const DEFAULT_CATEGORY = "工作";

const entryTableBody = document.querySelector("#entryTableBody");
const entryRowTemplate = document.querySelector("#entryRowTemplate");
const calendarGrid = document.querySelector("#calendarGrid");
const calendarTitle = document.querySelector("#calendarTitle");
const filterSummary = document.querySelector("#filterSummary");

const addRowButton = document.querySelector("#addRowButton");
const saveButton = document.querySelector("#saveButton");
const sampleButton = document.querySelector("#sampleButton");
const clearButton = document.querySelector("#clearButton");
const prevMonthButton = document.querySelector("#prevMonthButton");
const nextMonthButton = document.querySelector("#nextMonthButton");
const todayButton = document.querySelector("#todayButton");
const filterExactDate = document.querySelector("#filterExactDate");
const filterStartDate = document.querySelector("#filterStartDate");
const filterEndDate = document.querySelector("#filterEndDate");
const resetFilterButton = document.querySelector("#resetFilterButton");

let entries = loadEntries();
let currentMonth = new Date();
currentMonth.setDate(1);
let filters = {
  exactDate: "",
  startDate: "",
  endDate: ""
};

if (entries.length === 0) {
  entries = [createBlankEntry()];
}

initializeManagePage();
initializeCalendarPage();

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("載入資料失敗", error);
    return [];
  }
}

function persistEntries() {
  const cleanEntries = entries.filter((entry) => entry.date || entry.note);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanEntries));
}

function createBlankEntry() {
  return {
    id: createId(),
    date: "",
    category: DEFAULT_CATEGORY,
    note: "",
    color: DEFAULT_COLOR
  };
}

function createId() {
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderTable() {
  if (!entryTableBody || !entryRowTemplate) return;

  entryTableBody.innerHTML = "";
  const filteredEntries = getFilteredEntries();

  if (filteredEntries.length === 0) {
    entryTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state-cell">目前沒有符合篩選條件的資料。</td>
      </tr>
    `;
    updateFilterSummary(0);
    return;
  }

  filteredEntries.forEach((entry) => {
    const rowFragment = entryRowTemplate.content.cloneNode(true);
    const row = rowFragment.querySelector("tr");
    const dateInput = row.querySelector(".entry-date");
    const categorySelect = row.querySelector(".entry-category");
    const noteInput = row.querySelector(".entry-note");
    const colorInput = row.querySelector(".entry-color");
    const deleteButton = row.querySelector(".delete-row-button");

    dateInput.value = entry.date || "";
    categorySelect.value = entry.category || DEFAULT_CATEGORY;
    noteInput.value = entry.note || "";
    colorInput.value = entry.color || DEFAULT_COLOR;

    dateInput.addEventListener("input", (event) => updateEntry(entry.id, "date", event.target.value));
    categorySelect.addEventListener("change", (event) => updateEntry(entry.id, "category", event.target.value));
    noteInput.addEventListener("input", (event) => updateEntry(entry.id, "note", event.target.value));
    colorInput.addEventListener("input", (event) => updateEntry(entry.id, "color", event.target.value));

    deleteButton.addEventListener("click", () => {
      entries = entries.filter((item) => item.id !== entry.id);
      if (entries.length === 0) {
        entries.push(createBlankEntry());
      }
      persistEntries();
      renderTable();
      renderCalendar();
    });

    entryTableBody.appendChild(rowFragment);
  });

  updateFilterSummary(filteredEntries.length);
}

function updateEntry(entryId, key, value) {
  entries = entries.map((entry) => {
    if (entry.id !== entryId) return entry;
    return { ...entry, [key]: value };
  });
  persistEntries();
  renderCalendar();
}

function renderCalendar() {
  if (!calendarGrid || !calendarTitle) return;

  calendarGrid.innerHTML = "";

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const gridStart = new Date(year, month, 1 - startWeekday);

  calendarTitle.textContent = `${year} 年 ${month + 1} 月`;

  const filteredEntries = entries
    .filter((entry) => entry.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + index);

    const dateKey = formatDate(cellDate);
    const dayEntries = filteredEntries.filter((entry) => entry.date === dateKey);

    const dayCell = document.createElement("article");
    dayCell.className = "calendar-day";

    if (cellDate.getMonth() !== month) {
      dayCell.classList.add("other-month");
    }

    if (isSameDate(cellDate, new Date())) {
      dayCell.classList.add("is-today");
    }

    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = String(cellDate.getDate());
    dayCell.appendChild(number);

    const eventList = document.createElement("div");
    eventList.className = "event-list";

    dayEntries.forEach((entry) => {
      const chip = document.createElement("div");
      chip.className = "event-chip";
      chip.style.background = entry.color || DEFAULT_COLOR;

      const category = document.createElement("strong");
      category.textContent = entry.category || "未分類";

      const note = document.createElement("span");
      note.textContent = entry.note || "沒有備註";

      chip.append(category, note);
      eventList.appendChild(chip);
    });

    dayCell.appendChild(eventList);
    calendarGrid.appendChild(dayCell);
  }
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

function initializeManagePage() {
  if (addRowButton) {
    addRowButton.addEventListener("click", () => {
      entries.push(createBlankEntry());
      renderTable();
    });
  }

  if (saveButton) {
    saveButton.addEventListener("click", () => {
      persistEntries();
      renderCalendar();
      window.alert("資料已儲存。");
    });
  }

  if (sampleButton) {
    sampleButton.addEventListener("click", () => {
      entries = [
        { id: createId(), date: todayOffset(1), category: "工作", note: "提交報告", color: "#2563eb" },
        { id: createId(), date: todayOffset(2), category: "生日", note: "家人生日晚飯", color: "#db2777" },
        { id: createId(), date: todayOffset(4), category: "假期", note: "短途旅行", color: "#16a34a" },
        { id: createId(), date: todayOffset(7), category: "娛樂", note: "睇戲", color: "#ea580c" }
      ];
      persistEntries();
      renderTable();
      renderCalendar();
    });
  }

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      const shouldClear = window.confirm("確定清空全部資料？");
      if (!shouldClear) return;
      entries = [createBlankEntry()];
      persistEntries();
      renderTable();
      renderCalendar();
    });
  }

  [filterExactDate, filterStartDate, filterEndDate].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", handleFilterChange);
  });

  if (resetFilterButton) {
    resetFilterButton.addEventListener("click", () => {
      filters = { exactDate: "", startDate: "", endDate: "" };
      if (filterExactDate) filterExactDate.value = "";
      if (filterStartDate) filterStartDate.value = "";
      if (filterEndDate) filterEndDate.value = "";
      renderTable();
    });
  }

  if (entryTableBody) {
    renderTable();
  }
}

function initializeCalendarPage() {
  if (prevMonthButton) {
    prevMonthButton.addEventListener("click", () => {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
      renderCalendar();
    });
  }

  if (nextMonthButton) {
    nextMonthButton.addEventListener("click", () => {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
      renderCalendar();
    });
  }

  if (todayButton) {
    todayButton.addEventListener("click", () => {
      currentMonth = new Date();
      currentMonth.setDate(1);
      renderCalendar();
    });
  }

  if (calendarGrid) {
    renderCalendar();
  }
}

function handleFilterChange() {
  filters = {
    exactDate: filterExactDate?.value || "",
    startDate: filterStartDate?.value || "",
    endDate: filterEndDate?.value || ""
  };
  renderTable();
}

function getFilteredEntries() {
  return entries.filter((entry) => matchesFilter(entry));
}

function matchesFilter(entry) {
  const { exactDate, startDate, endDate } = filters;
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

  const hasExactDate = Boolean(filters.exactDate);
  const hasRange = Boolean(filters.startDate || filters.endDate);

  if (hasExactDate) {
    filterSummary.textContent = `現正顯示 ${count} 筆指定日期資料。`;
    return;
  }

  if (hasRange) {
    filterSummary.textContent = `現正顯示 ${count} 筆日期範圍內資料。`;
    return;
  }

  filterSummary.textContent = `現正顯示全部 ${count} 筆資料，可直接像 Excel 一樣逐行輸入。`;
}
