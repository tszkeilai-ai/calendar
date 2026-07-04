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
const EVENT_SELECT_BASE = "id,user_id,event_date,event_time,title,description,color,reminder_time";
const EVENT_SELECT_WITH_BG = `${EVENT_SELECT_BASE},bg_color`;
let supportsBgColorColumn = true;

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

function createLocalDateTime(dateValue, timeValue = "00:00:00") {
  const [year, month, day] = String(dateValue || "")
    .split("-")
    .map((value) => Number(value));
  const [hours, minutes, seconds = 0] = String(timeValue || "00:00:00")
    .split(":")
    .map((value) => Number(value));

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds)
  ) {
    return null;
  }

  return new Date(year, month - 1, day, hours, minutes, seconds, 0);
}

function formatDateTimeToSQL(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${formatDateToISO(date)} ${formatTimeToHM(date)}:${seconds}`;
}

function normalizeReminderDateTimeValue(value = null) {
  if (!value) return null;

  const rawValue = String(value).trim();
  const matchedValue = rawValue.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (matchedValue) {
    return `${matchedValue[1]} ${matchedValue[2]}`;
  }

  return null;
}

function splitReminderDateTimeValue(value = null) {
  const normalizedValue = normalizeReminderDateTimeValue(value);
  if (!normalizedValue) {
    return { raw: "", date: "", time: "", minuteKey: "" };
  }

  const [datePart = "", timePart = ""] = normalizedValue.split(" ");
  const normalizedTime = String(timePart || "").slice(0, 8);
  const minuteTime = normalizedTime.slice(0, 5);

  return {
    raw: normalizedValue,
    date: datePart,
    time: normalizedTime,
    minuteKey: datePart && minuteTime ? `${datePart} ${minuteTime}` : "",
  };
}

function getRelativeReminderDayLabel(targetDateValue, referenceDateValue) {
  const targetDateISO = splitReminderDateTimeValue(`${targetDateValue} 00:00:00`).date || targetDateValue;
  if (!targetDateISO) {
    return "";
  }

  if (!referenceDateValue) return formatDateLabel(targetDateISO);
  if (targetDateISO === referenceDateValue) return "當天";

  const referenceDate = createLocalDateTime(referenceDateValue, "00:00:00");
  const targetMidnight = createLocalDateTime(targetDateISO, "00:00:00");
  if (!referenceDate || !targetMidnight) return formatDateLabel(targetDateISO);

  const diffDays = Math.round((targetMidnight.getTime() - referenceDate.getTime()) / 86400000);
  if (diffDays === -1) return "前一天";
  if (diffDays === 1) return "後一天";

  return formatDateLabel(targetDateISO);
}

function formatReminderDisplayLabel(value = null, referenceDateValue = "") {
  const { date, time } = splitReminderDateTimeValue(value);
  if (!date || !time) return "";

  const dayLabel = getRelativeReminderDayLabel(date, referenceDateValue);
  return `${dayLabel} ${time.slice(0, 5)}`;
}

function formatReminderOptionTimeLabel(dateTimeText, referenceDateValue, suffix = "") {
  const { date, time } = splitReminderDateTimeValue(dateTimeText);
  if (!date || !time) return "";

  const baseLabel = date === referenceDateValue ? time.slice(0, 5) : `${getRelativeReminderDayLabel(date, referenceDateValue)} ${time.slice(0, 5)}`;
  return suffix ? `${baseLabel} ${suffix}` : baseLabel;
}

function buildLocalDateTimeText(dateValue, timeValue = "00:00:00") {
  const normalizedDate = String(dateValue || "").trim();
  const normalizedTime = String(timeValue || "00:00:00").trim();
  const timeParts = normalizedTime.split(":");
  const hours = String(timeParts[0] || "00").padStart(2, "0");
  const minutes = String(timeParts[1] || "00").padStart(2, "0");
  const seconds = String(timeParts[2] || "00").padStart(2, "0");

  if (!normalizedDate) return "";
  return `${normalizedDate} ${hours}:${minutes}:${seconds}`;
}

function getCurrentLocalDateTimeText() {
  const now = new Date();
  return buildLocalDateTimeText(formatDateToISO(now), `${formatTimeToHM(now)}:${String(now.getSeconds()).padStart(2, "0")}`);
}

function getMinuteKeyFromDateTimeText(value = null) {
  return splitReminderDateTimeValue(value).minuteKey;
}

function buildEventTimeChoices(selectedValue = "") {
  const choices = new Set();

  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 5) {
      choices.add(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }

  const normalizedSelectedValue = formatTimeLabel(selectedValue);
  if (normalizedSelectedValue) {
    choices.add(normalizedSelectedValue);
  }

  return Array.from(choices).sort((left, right) => left.localeCompare(right));
}

function populateEventTimeField(field, selectedValue = "") {
  if (!field) return;

  const normalizedSelectedValue = formatTimeLabel(selectedValue);
  if (field.tagName !== "SELECT") {
    field.value = normalizedSelectedValue;
    return;
  }

  const choices = buildEventTimeChoices(normalizedSelectedValue);
  field.innerHTML = choices
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}"${value === normalizedSelectedValue ? " selected" : ""}>${escapeHtml(value)}</option>`
    )
    .join("");

  if (normalizedSelectedValue) {
    field.value = normalizedSelectedValue;
  }
}

/* 🎯 已修正的鬧鐘時間選單邏輯：無條件捨去至當個小時的整點，再往前推算 */
function buildReminderChoices(isoDate, timeValue, selectedValue = "") {
  const defaultChoices = [{ value: "", label: "不需要提醒" }];
  const normalizedTimeValue = formatTimeLabel(timeValue);

  if (!isoDate || !normalizedTimeValue) {
    return defaultChoices;
  }

  const eventDateTime = createLocalDateTime(isoDate, `${normalizedTimeValue}:00`);
  if (!eventDateTime || Number.isNaN(eventDateTime.getTime())) {
    return defaultChoices;
  }

  // 1. 無條件捨去至當前小時的整點 (例如 12:10, 12:45, 12:55 -> 12:00)
  const currentIntegerHourDate = new Date(eventDateTime.getTime());
  currentIntegerHourDate.setMinutes(0, 0, 0);

  // 2. 當前整點往前推 1 小時 (例如 12:00 往前推 1 小時 = 11:00)
  const targetHour1 = new Date(currentIntegerHourDate.getTime());
  targetHour1.setHours(targetHour1.getHours() - 1);
  const targetHour1Text = formatDateTimeToSQL(targetHour1);

  // 3. 當前整點往前推 2 小時 (例如 12:00 往前推 2 小時 = 10:00)
  const targetHour2 = new Date(currentIntegerHourDate.getTime());
  targetHour2.setHours(targetHour2.getHours() - 2);
  const targetHour2Text = formatDateTimeToSQL(targetHour2);

  // 4. 固定選項：前一天的 09:00:00 整
  const previousDayNine = createLocalDateTime(isoDate, "09:00:00");
  if (!previousDayNine || Number.isNaN(previousDayNine.getTime())) {
    return defaultChoices;
  }
  previousDayNine.setDate(previousDayNine.getDate() - 1);
  const previousDayNineText = formatDateTimeToSQL(previousDayNine);

  const dedupedChoices = new Map(
    [
      ...defaultChoices,
      {
        value: targetHour1Text,
        label: formatReminderOptionTimeLabel(targetHour1Text, isoDate),
      },
      {
        value: targetHour2Text,
        label: formatReminderOptionTimeLabel(targetHour2Text, isoDate),
      },
      {
        value: previousDayNineText,
        label: "前一天 09:00",
      },
    ]
      .filter((choice) => choice.value)
      .map((choice) => [choice.value, choice])
  );

  const normalizedSelectedValue = normalizeReminderDateTimeValue(selectedValue);
  if (normalizedSelectedValue && !dedupedChoices.has(normalizedSelectedValue)) {
    dedupedChoices.set(normalizedSelectedValue, {
      value: normalizedSelectedValue,
      label: `自訂 ${formatReminderDisplayLabel(normalizedSelectedValue, isoDate)}`,
    });
  }

  return Array.from(dedupedChoices.values());
}

function populateReminderField(field, isoDate, timeValue, selectedValue = "") {
  if (!field) return;

  const normalizedSelectedValue = normalizeReminderDateTimeValue(selectedValue) || "";
  const choices = buildReminderChoices(isoDate, timeValue, normalizedSelectedValue);

  field.innerHTML = choices
    .map(
      (choice) =>
        `<option value="${escapeHtml(choice.value)}"${choice.value === normalizedSelectedValue ? " selected" : ""}>${escapeHtml(choice.label)}</option>`
    )
    .join("");

  field.value = choices.some((choice) => choice.value === normalizedSelectedValue)
    ? normalizedSelectedValue
    : "";
}

function getReminderSourceDate(dateFieldValue = "") {
  return dateFieldValue || selectedCalendarDate || "";
}

function normalizeBgColor(value = "") {
  const normalized = String(value || "").trim();
  return /^#([0-9a-fA-F]{6})$/.test(normalized) ? normalized : "#ffffff";
}

function normalizeEventRecord(record = {}) {
  return {
    ...record,
    reminder_time: normalizeReminderDateTimeValue(record?.reminder_time),
    bg_color: normalizeBgColor(record?.bg_color),
  };
}

function normalizeEventRecords(records = []) {
  return (records || []).map((record) => normalizeEventRecord(record));
}

function isMissingBgColorColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("bg_color") && message.includes("does not exist");
}

function getEventSelectColumns() {
  return supportsBgColorColumn ? EVENT_WITH_BG = EVENT_SELECT_WITH_BG : EVENT_SELECT_BASE;
}

function getEventPayload(basePayload, includeBgColor = supportsBgColorColumn) {
  if (!includeBgColor) return { ...basePayload };
  return {
    ...basePayload,
    bg_color: normalizeBgColor(basePayload.bg_color),
  };
}

async function runEventSelectQuery(buildQuery) {
  const primaryResult = await buildQuery(supportsBgColorColumn ? EVENT_SELECT_WITH_BG : EVENT_SELECT_BASE);

  if (!primaryResult.error) {
    return normalizeEventRecords(primaryResult.data || []);
  }

  if (supportsBgColorColumn && isMissingBgColorColumnError(primaryResult.error)) {
    supportsBgColorColumn = false;
    const fallbackResult = await buildQuery(EVENT_SELECT_BASE);
    if (fallbackResult.error) throw fallbackResult.error;
    return normalizeEventRecords(fallbackResult.data || []);
  }

  throw primaryResult.error;
}

async function saveEventRecord({
  mode,
  userId,
  entryId = null,
  payload,
}) {
  const attemptSave = async (includeBgColor) => {
    const query =
      mode === "edit"
        ? supabaseClient.from(EVENTS_TABLE).update(getEventPayload(payload, includeBgColor))
        : supabaseClient.from(EVENTS_TABLE).insert(getEventPayload(payload, includeBgColor));

    if (mode === "edit") {
      query.eq("id", entryId).eq("user_id", userId);
    }

    return query.select(includeBgColor ? EVENT_SELECT_WITH_BG : EVENT_SELECT_BASE).single();
  };

  const primaryResult = await attemptSave(supportsBgColorColumn);

  if (!primaryResult.error) {
    return normalizeEventRecord(primaryResult.data || {});
  }

  if (supportsBgColorColumn && isMissingBgColorColumnError(primaryResult.error)) {
    supportsBgColorColumn = false;
    const fallbackResult = await attemptSave(false);
    if (fallbackResult.error) throw fallbackResult.error;
    return normalizeEventRecord(fallbackResult.data || {});
  }

  throw primaryResult.error;
}

function pickDayBackgroundColor(events = []) {
  const matchedEvent = events.find((event) => normalizeBgColor(event.bg_color) !== "#ffffff");
  return matchedEvent ? normalizeBgColor(matchedEvent.bg_color) : "";
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

function renderEmptyActionState(targetElement, isoDate, onAction) {
  if (!targetElement) return;

  targetElement.innerHTML = `
    <li class="entry-item">
      <div class="empty-state-pencell" style="text-align: center; padding: 24px 16px;">
        <p style="color: var(--text-soft); margin-bottom: 12px; font-size: 0.95rem;">
          ${escapeHtml(formatDateLabel(isoDate))} 目前沒有記事,請點鉛筆圖案「新增今天記事」建立。
        </p>
        <button
          type="button"
          class="entry-action-button edit-button"
          id="blank-day-quick-create"
          style="margin: 0 auto; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); border: none; font-size: 1.2rem;"
        >
          ✏️
        </button>
      </div>
    </li>
  `;

  targetElement.querySelector("#blank-day-quick-create")?.addEventListener("click", () => {
    if (typeof onAction === "function") {
      onAction();
    }
  });
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
      const reminderLabel = formatReminderDisplayLabel(event.reminder_time, event.event_date);

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
          ${
            reminderLabel
              ? `<p class="entry-reminder-line">⏰ 鬧鐘：${escapeHtml(reminderLabel)}</p>`
              : ""
          }
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

const REMINDER_CHECK_INTERVAL = 15000;
const reminderToastKeys = new Set();
let reminderCheckTimer = null;

function getReminderStorageKey(event = {}) {
  return `calendar-reminder:${event.id || "unknown"}:${normalizeReminderDateTimeValue(event.reminder_time) || ""}`;
}

function hasReminderBeenTriggered(event = {}) {
  try {
    return window.localStorage.getItem(getReminderStorageKey(event)) === "done";
  } catch (error) {
    return false;
  }
}

function markReminderAsTriggered(event = {}) {
  try {
    window.localStorage.setItem(getReminderStorageKey(event), "done");
  } catch (error) {
    console.warn("無法寫入提醒快取：", error);
  }
}

function ensureAlarmToastRegion() {
  let region = document.querySelector(".alarm-toast-region");
  if (region) return region;

  region = document.createElement("div");
  region.className = "alarm-toast-region";
  document.body.appendChild(region);
  return region;
}

function showAlarmToast(title, message, key) {
  if (key && reminderToastKeys.has(key)) return;
  if (key) reminderToastKeys.add(key);

  const region = ensureAlarmToastRegion();
  const toast = document.createElement("article");
  toast.className = "alarm-toast";
  toast.innerHTML = `
    <p class="alarm-toast__title">${escapeHtml(title)}</p>
    <p class="alarm-toast__message">${escapeHtml(message)}</p>
  `;

  region.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
    if (key) reminderToastKeys.delete(key);
  }, 6000);
}

async function requestNotificationPermissionIfPossible() {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;

  try {
    return await Notification.requestPermission();
  } catch (error) {
    return Notification.permission;
  }
}

function triggerReminder(event) {
  if (!event?.id || !event?.reminder_time || hasReminderBeenTriggered(event)) return;

  const reminderKey = getReminderStorageKey(event);
  const eventTimeLabel = formatTimeLabel(event.event_time);
  const reminderLabel = formatReminderDisplayLabel(event.reminder_time, event.event_date);
  const title = `⏰ ${event.title || "記事提醒"}`;
  const message = `${formatDateLabel(event.event_date)} ${eventTimeLabel}，提醒時間：${reminderLabel}`;

  markReminderAsTriggered(event);
  showAlarmToast(title, message, reminderKey);

  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate([180, 120, 180]);
  }

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(title, {
        body: message,
        tag: reminderKey,
      });
    } catch (error) {
      console.warn("建立通知失敗：", error);
    }
  }
}

function startReminderWatch(events = []) {
  if (reminderCheckTimer) {
    window.clearInterval(reminderCheckTimer);
    reminderCheckTimer = null;
  }

  const reminderEvents = (events || []).filter((event) => event?.id && event?.reminder_time);
  if (!reminderEvents.length) return;

  const checkReminders = () => {
    const currentMinuteKey = getMinuteKeyFromDateTimeText(getCurrentLocalDateTimeText());
    if (!currentMinuteKey) return;

    reminderEvents.forEach((event) => {
      const reminderMinuteKey = getMinuteKeyFromDateTimeText(event.reminder_time);
      if (!reminderMinuteKey) return;

      if (reminderMinuteKey === currentMinuteKey) {
        triggerReminder(event);
      }
    });
  };

  checkReminders();
  reminderCheckTimer = window.setInterval(checkReminders, REMINDER_CHECK_INTERVAL);
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
  return runEventSelectQuery((columns) =>
    supabaseClient
      .from(EVENTS_TABLE)
      .select(columns)
      .eq("user_id", userId)
      .eq("event_date", isoDate)
      .order("event_time", { ascending: true })
  );
}

async function fetchEventsByMonth(userId, monthValue) {
  const [year, month] = String(monthValue).split("-").map(Number);
  const firstDate = formatDateToISO(new Date(year, month - 1, 1));
  const lastDate = formatDateToISO(new Date(year, month, 0));

  return runEventSelectQuery((columns) =>
    supabaseClient
      .from(EVENTS_TABLE)
      .select(columns)
      .eq("user_id", userId)
      .gte("event_date", firstDate)
      .lte("event_date", lastDate)
      .order("event_date", { ascending: true })
      .order("event_time", { ascending: true })
  );
}

async function fetchEventsFromDate(userId, startDate) {
  return runEventSelectQuery((columns) =>
    supabaseClient
      .from(EVENTS_TABLE)
      .select(columns)
      .eq("user_id", userId)
      .gte("event_date", startDate)
      .order("event_date", { ascending: true })
      .order("event_time", { ascending: true })
  );
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
  const modalEventTime = $("#modal-event-time") || $("#modal-time");
  const modalReminderTime = $("#modal-reminder-time");
  const modalTitleInput = $("#modal-title-input");
  const modalEmoji = $("#modal-emoji");
  const modalDescription = $("#modal-description");
  const modalBgColor = $("#modal-bg-color");
  const modalStatus = $("#modal-status");
  const modalSubmitButton = $("#modal-submit-button");
  const modalDeleteButton = $("#modal-delete-button");
  const closeButton = $("#modal-close-button");
  const cancelButton = $("#modal-cancel-button");

  function syncDeleteButtonVisibility(mode = "create") {
    if (!modalDeleteButton) return;
    modalDeleteButton.style.display = mode === "edit" ? "block" : "none";
  }

  function refreshReminderOptions(selectedValue = "") {
    populateReminderField(
      modalReminderTime,
      getReminderSourceDate(modalDate?.value || ""),
      modalEventTime?.value || "",
      selectedValue
    );
  }

  function handleFormSubmit(event) {
    event.preventDefault();

    const sanitizedEmoji = sanitizeSingleEmojiInput(modalEmoji.value);
    modalEmoji.value = sanitizedEmoji;

    if (!modalDate.value || !modalEventTime?.value || !modalTitleInput.value.trim() || !sanitizedEmoji) {
      setStatus(modalStatus, "請完整填寫日期、時間、主題與 1 個 Emoji。", "error");
      return;
    }

    (async () => {
      try {
        setStatus(modalStatus, modalState.mode === "edit" ? "正在儲存修改..." : "正在新增記事...");

        const user = await getCurrentUser();
        if (!user) throw new Error("登入狀態已失效，請重新登入。");

        const payload = {
          user_id: user.id,
          event_date: modalDate.value,
          event_time: modalEventTime.value,
          title: modalTitleInput.value.trim(),
          description: modalDescription.value.trim(),
          color: sanitizedEmoji,
          reminder_time: document.getElementById("modal-reminder-time")?.value || null,
          bg_color: normalizeBgColor(modalBgColor?.value || "#ffffff"),
        };

        if (payload.reminder_time) {
          await requestNotificationPermissionIfPossible();
        }

        const savedEntry = await saveEventRecord({
          mode: modalState.mode === "edit" && modalState.editingEntryId ? "edit" : "create",
          userId: user.id,
          entryId: modalState.editingEntryId,
          payload,
        });

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
    })();
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
    if (modalBgColor) {
      modalBgColor.value = "#ffffff";
    }
    populateEventTimeField(modalEventTime, formatTimeToHM(new Date()));
    refreshReminderOptions("");
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

    if (modalTitle) {
      modalTitle.textContent = title;
    }
    if (modalSubtitle) {
      modalSubtitle.textContent = subtitle || "";
    }
    if (modalSubmitButton) {
      modalSubmitButton.textContent = submitLabel;
    }
    syncDeleteButtonVisibility(mode);

    modalDate.value = entry?.event_date || defaultDate;
    populateEventTimeField(modalEventTime, formatTimeLabel(entry?.event_time || defaultTime));
    modalTitleInput.value = entry?.title || "";
    modalEmoji.value = sanitizeSingleEmojiInput(entry?.color || "");
    modalDescription.value = entry?.description || "";
    if (modalBgColor) {
      modalBgColor.value = normalizeBgColor(entry?.bg_color || "#ffffff");
    }
    refreshReminderOptions(mode === "edit" ? entry?.reminder_time || "" : "");
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

      const user =
