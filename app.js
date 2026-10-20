(function () {
  "use strict";

  var SCRIPT_URL = (window.GTO_CONFIG && window.GTO_CONFIG.SCRIPT_URL) || "";
  var UIN_RE = /^\d{2}-\d{2}-\d{7}$/;

  var form = document.getElementById("form");
  var datesBox = document.getElementById("dates");
  var fieldsBox = document.getElementById("fields");
  var submitBtn = document.getElementById("submit");
  var message = document.getElementById("message");
  var detailsBox = document.getElementById("details");
  var doneBox = document.getElementById("done");
  var progressSteps = document.querySelectorAll("#progress li");

  var rulesDialog = document.getElementById("rules");
  var rulesText = document.getElementById("rules-text");

  var sheets = [];   // описание листов-дат, приходит из Apps Script
  var rules = [];    // абзацы текста правил с листа «Правила»
  var rulesAccepted = false;
  var current = null; // выбранный лист

  var GENDER_NAMES = { "м": "Мужской", "ж": "Женский" };
  var MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  var MONTHS_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  var PLACEHOLDERS = {
    fio: "Иванов Иван Иванович",
    uin: "00-00-0000000",
    letter: "А",
  };

  function showMessage(text, kind) {
    message.textContent = text;
    message.className = "message " + kind;
    message.hidden = false;
  }

  // Открыть окно и заблокировать прокрутку страницы под ним.
  function openModal(dialog) {
    document.documentElement.classList.add("modal-open");
    dialog.showModal();
  }

  document.addEventListener("close", function () {
    if (!document.querySelector("dialog[open]")) document.documentElement.classList.remove("modal-open");
  }, true);

  // Отмечает текущий этап в шапке: 1 — дата, 2 — анкета, 3 — готово.
  function setStep(n) {
    progressSteps.forEach(function (li, i) {
      li.classList.toggle("is-done", i + 1 < n);
      li.classList.toggle("is-active", i + 1 === n);
      if (i + 1 === n) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
  }

  // «23.11.26» → { day: "23", month: "ноя", short: "23 ноября", full: "23 ноября 2026", weekday: "понедельник" }
  function parseDate(s) {
    var m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(s);
    if (!m) return null;
    var d = new Date(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return {
      day: String(Number(m[1])),
      month: MONTHS[d.getMonth()],
      short: Number(m[1]) + " " + MONTHS_FULL[d.getMonth()],
      full: Number(m[1]) + " " + MONTHS_FULL[d.getMonth()] + " " + d.getFullYear(),
      weekday: WEEKDAYS[d.getDay()],
    };
  }

  function caption(label) {
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function hideMessage() {
    message.hidden = true;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  /* ---------- Даты ---------- */

  function renderDates() {
    datesBox.innerHTML = "";
    if (!sheets.length) {
      datesBox.appendChild(el("p", { class: "empty", text: "Сейчас нет открытых дат для записи." }));
      return;
    }
    sheets.forEach(function (s, i) {
      var input = el("input", { type: "radio", name: "sheet", value: String(i) });
      input.addEventListener("change", function () { chooseSheet(i); });
      var d = parseDate(s.date);
      var info = el("span", { class: "date-info" });
      if (s.label) info.appendChild(el("span", { class: "date-label", text: s.label }));
      info.appendChild(el("span", { class: "date-sub", text: d ? d.short + ", " + d.weekday : s.date }));
      var card = el("span", { class: "date" }, [
        el("span", { class: "date-cal", "aria-hidden": "true" }, [
          el("span", { class: "date-month", text: d ? d.month : "" }),
          el("span", { class: "date-day", text: d ? d.day : s.date }),
        ]),
        info,
        el("span", { class: "date-check", "aria-hidden": "true" }),
      ]);
      datesBox.appendChild(el("label", {}, [input, card]));
    });
    if (sheets.length === 1) {
      datesBox.querySelector("input").checked = true;
      chooseSheet(0);
    }
  }

  // При первом выборе даты сначала показываем информационное окно, поля — после «На сайте ГТО зарегистрирован».
  function chooseSheet(i) {
    if (rulesAccepted) {
      selectSheet(i);
      return;
    }
    openRules(function () {
      rulesAccepted = true;
      selectSheet(i);
    });
  }

  // Окно закрыли без согласия — возвращаем выбор даты как было.
  function revertDate() {
    datesBox.querySelectorAll("input").forEach(function (input) {
      input.checked = !!current && sheets[Number(input.value)] === current;
    });
  }

  function selectSheet(i) {
    // Сохраняем уже введённые значения, если такие же поля есть на другой дате.
    var prev = current ? collect() : {};
    var first = !current;
    current = sheets[i];
    hideMessage();
    renderFields(prev);
    detailsBox.hidden = false;
    submitBtn.hidden = false;
    setStep(2);
    // На телефоне анкета ниже экрана — плавно прокручиваем к ней при первом выборе даты.
    if (first && detailsBox.getBoundingClientRect().top > window.innerHeight * 0.7) {
      detailsBox.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* ---------- Поля формы ---------- */

  function renderFields(prev) {
    fieldsBox.innerHTML = "";
    current.fields.forEach(function (f, i) {
      if (f.kind === "rules") return; // отмечается в окне с правилами
      var id = "f" + i;
      var control;

      if (f.options && f.options.length <= 3 && f.kind !== "stage" && f.kind !== "grade") {
        control = renderToggle(f, id);
      } else if (f.options) {
        control = renderSelect(f, id);
      } else {
        control = renderInput(f, id);
      }

      var wrap = control.tagName === "FIELDSET"
        ? control
        : el("label", { for: id, class: "field" }, [el("span", { class: "field-label", text: caption(f.label) }), control]);
      if (f.kind === "fio" || f.kind === "uin" || f.kind === "text") wrap.classList.add("field-wide");
      if (f.kind === "uin") {
        wrap.appendChild(el("small", { class: "hint", text: "11 цифр из личного кабинета на gto.ru" }));
      }
      fieldsBox.appendChild(wrap);
      setValue(f, id, prev[f.label]);
    });
  }

  function renderSelect(f, id) {
    var select = el("select", { id: id, name: f.label, required: "" });
    select.add(new Option("—", ""));
    f.options.forEach(function (o) {
      var text = o;
      if (f.kind === "grade" && /^\d+$/.test(o)) text = o + " класс";
      if (f.kind === "stage" && /^\d+$/.test(o)) text = o + " ступень";
      select.add(new Option(text, o));
    });
    if (f.options.length === 1) select.value = f.options[0];
    return select;
  }

  function renderToggle(f, id) {
    var group = el("div", { class: "toggle", id: id });
    f.options.forEach(function (o) {
      var name = f.kind === "gender" ? GENDER_NAMES[o.toLowerCase()] || o : o;
      group.appendChild(el("label", {}, [
        el("input", { type: "radio", name: f.label, value: o }),
        el("span", { text: name }),
      ]));
    });
    return el("fieldset", { class: "field" }, [el("legend", { class: "field-label", text: caption(f.label) }), group]);
  }

  function renderInput(f, id) {
    var input = el("input", { id: id, name: f.label, required: "" });
    if (PLACEHOLDERS[f.kind]) input.placeholder = PLACEHOLDERS[f.kind];
    if (f.kind === "fio") input.autocomplete = "name";
    if (f.kind === "uin") {
      input.inputMode = "numeric";
      input.maxLength = 13;
      input.addEventListener("input", function () {
        var d = input.value.replace(/\D/g, "").slice(0, 11);
        var out = d.slice(0, 2);
        if (d.length > 2) out += "-" + d.slice(2, 4);
        if (d.length > 4) out += "-" + d.slice(4);
        input.value = out;
      });
    }
    if (f.kind === "letter") {
      input.maxLength = 1;
      input.addEventListener("input", function () {
        input.value = input.value.replace(/[^а-яё]/gi, "").toUpperCase().slice(0, 1);
      });
    }
    return input;
  }

  function setValue(f, id, value) {
    if (value == null || value === "") return;
    var radio = fieldsBox.querySelector('input[type=radio][name="' + CSS.escape(f.label) + '"][value="' + CSS.escape(value) + '"]');
    if (radio) { radio.checked = true; return; }
    var control = document.getElementById(id);
    if (control.tagName === "SELECT" && f.options.indexOf(value) === -1) return;
    if (control.tagName !== "DIV") control.value = value;
  }

  function collect() {
    var values = {};
    var fd = new FormData(form);
    current.fields.forEach(function (f) {
      if (f.kind === "rules") return;
      values[f.label] = String(fd.get(f.label) || "").replace(/\s+/g, " ").trim();
    });
    return values;
  }

  function validate(values) {
    var errors = [];
    fieldsBox.querySelectorAll(".invalid").forEach(function (n) { n.classList.remove("invalid"); });
    current.fields.forEach(function (f, i) {
      if (f.kind === "rules") return;
      var v = values[f.label];
      var problem = null;
      if (!v) problem = "заполните «" + caption(f.label) + "»";
      else if (f.kind === "uin" && !UIN_RE.test(v)) problem = "укажите УИН в формате 00-00-0000000";
      else if (f.kind === "fio" && v.split(" ").length < 2) problem = "укажите фамилию и имя";
      if (problem) {
        errors.push(problem);
        var node = document.getElementById("f" + i);
        if (node) node.classList.add("invalid");
      }
    });
    return errors;
  }

  /* ---------- Загрузка и отправка ---------- */

  function load() {
    if (!SCRIPT_URL) {
      datesBox.innerHTML = "";
      showMessage("Не указан адрес Google Apps Script в config.js.", "err");
      return;
    }
    // Google Apps Script после простоя отвечает несколько секунд; если ответа нет 30 с — сообщаем об ошибке.
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 30000);
    fetch(SCRIPT_URL, controller ? { signal: controller.signal } : {})
      .then(function (r) { clearTimeout(timer); return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error);
        sheets = res.sheets || [];
        rules = res.rules || [];
        renderDates();
      })
      .catch(function () {
        clearTimeout(timer);
        datesBox.innerHTML = "";
        showMessage("Не удалось загрузить даты сдачи. Проверьте интернет и обновите страницу.", "err");
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!current) {
      showMessage("Выберите дату сдачи.", "err");
      return;
    }
    var values = collect();
    var errors = validate(values);
    if (errors.length) {
      showMessage("Проверьте форму: " + errors.join(", ") + ".", "err");
      return;
    }
    hideMessage();

    // С информационным окном участник уже ознакомился при выборе даты.
    var rulesField = current.fields.filter(function (f) { return f.kind === "rules"; })[0];
    if (rulesField) values[rulesField.label] = true;
    send(values);
  });

  /* ---------- Окно с правилами ---------- */

  var onAccept = null;

  function openRules(callback) {
    onAccept = callback;
    rulesText.innerHTML = "";
    var list = null;
    var lines = rules.length ? rules : window.GTO_RULES || [];
    lines.forEach(function (line) {
      line = String(line).trim();
      if (!line) return;
      var item = /^[-•–*]\s*([\s\S]+)$/.exec(line);
      if (item) {
        if (!list) list = rulesText.appendChild(el("ul"));
        list.appendChild(linkify(el("li"), item[1]));
        return;
      }
      list = null;
      // «1. …» — шаг с номером, «! …» — предупреждение с восклицательным знаком вместо номера.
      var step = /^(\d+)[.)]\s*([\s\S]+)$/.exec(line);
      var warn = /^!+\s*([\s\S]+)$/.exec(line);
      if (step || warn) {
        rulesText.appendChild(el("h3", warn ? { class: "warn" } : {}, [
          el("span", { class: "step", text: warn ? "!" : step[1] }),
          linkify(el("span"), warn ? warn[1] : step[2]),
        ]));
      } else {
        rulesText.appendChild(linkify(el("p"), line));
      }
    });
    openModal(rulesDialog);
    rulesText.scrollTop = 0;
  }

  // Добавляет в node текст, превращая адреса сайтов в ссылки.
  function linkify(node, text) {
    var re = /https?:\/\/[^\s]+[^\s.,:;!?)]/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      node.appendChild(document.createTextNode(text.slice(last, m.index)));
      node.appendChild(el("a", { href: m[0], target: "_blank", rel: "noopener", text: m[0] }));
      last = m.index + m[0].length;
    }
    node.appendChild(document.createTextNode(text.slice(last)));
    return node;
  }

  document.getElementById("rules-accept").addEventListener("click", function () {
    rulesDialog.close();
    var cb = onAccept;
    onAccept = null;
    if (cb) cb();
  });

  rulesDialog.addEventListener("close", function () {
    if (onAccept) {
      onAccept = null;
      revertDate();
    }
  });

  /* ---------- Окно «Хотите отредактировать данные?» ---------- */

  var confirmDialog = document.getElementById("confirm");
  var confirmText = document.getElementById("confirm-text");
  var onConfirm = null;

  function askEdit(res, callback) {
    onConfirm = callback;
    confirmText.innerHTML = "";
    confirmText.appendChild(el("p", { text: "Участник с таким УИН уже записан на " + res.title + ". Сейчас в списке:" }));
    var list = el("ul", { class: "current" });
    Object.keys(res.current || {}).forEach(function (k) {
      list.appendChild(el("li", {}, [el("span", { text: caption(k) + ": " }), document.createTextNode(res.current[k])]));
    });
    confirmText.appendChild(list);
    confirmText.appendChild(el("p", { text: "Хотите отредактировать данные? Они будут заменены на введённые в форме." }));
    openModal(confirmDialog);
  }

  document.getElementById("confirm-yes").addEventListener("click", function () {
    confirmDialog.close();
    var cb = onConfirm;
    onConfirm = null;
    if (cb) cb();
  });

  document.getElementById("confirm-no").addEventListener("click", function () {
    confirmDialog.close();
  });

  confirmDialog.addEventListener("close", function () {
    if (onConfirm) {
      onConfirm = null;
      showMessage("Данные не изменены.", "err");
    }
  });

  /* ---------- Экран «Вы записаны» ---------- */

  function showDone(values, res) {
    var fioField = current.fields.filter(function (f) { return f.kind === "fio"; })[0];
    var fio = fioField ? values[fioField.label] : "";
    document.getElementById("done-title").textContent = res.updated ? "Данные обновлены" : "Вы записаны!";
    document.getElementById("done-text").textContent = res.updated
      ? "Изменения сохранены в списке участников."
      : "Заявка принята. Ждём вас на сдаче нормативов.";

    var d = parseDate(res.date || current.date);
    var rows = [
      ["Участник", fio],
      ["Дата", (d ? d.full + ", " + d.weekday : current.date)],
      ["Группа", current.label],
      ["Номер в списке", String(res.number)],
    ];
    var dl = document.getElementById("done-details");
    dl.innerHTML = "";
    rows.forEach(function (r) {
      if (!r[1]) return;
      dl.appendChild(el("dt", { text: r[0] }));
      dl.appendChild(el("dd", { text: r[1] }));
    });

    form.hidden = true;
    doneBox.hidden = false;
    setStep(3);
    doneBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  document.getElementById("again").addEventListener("click", function () {
    doneBox.hidden = true;
    form.hidden = false;
    hideMessage();
    renderFields({});
    setStep(2);
    detailsBox.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle("is-loading", on);
    submitBtn.querySelector(".btn-label").textContent = on ? "Отправка…" : "Зарегистрироваться";
  }

  function send(values, update) {
    setLoading(true);

    // text/plain — чтобы браузер не отправлял preflight-запрос, который Apps Script не поддерживает.
    fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ sheet: current.sheet, values: values, update: !!update }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          showDone(values, res);
        } else if (res.exists) {
          askEdit(res, function () { send(values, true); });
        } else {
          showMessage(res.error || "Ошибка регистрации.", "err");
        }
      })
      .catch(function () {
        showMessage("Нет связи с сервером. Попробуйте ещё раз.", "err");
      })
      .finally(function () {
        setLoading(false);
      });
  }

  load();
})();
