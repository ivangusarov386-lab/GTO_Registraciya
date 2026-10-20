(function () {
  "use strict";

  var SCRIPT_URL = (window.GTO_CONFIG && window.GTO_CONFIG.SCRIPT_URL) || "";
  var UIN_RE = /^\d{2}-\d{2}-\d{7}$/;

  var form = document.getElementById("form");
  var datesBox = document.getElementById("dates");
  var fieldsBox = document.getElementById("fields");
  var submitBtn = document.getElementById("submit");
  var message = document.getElementById("message");

  var rulesDialog = document.getElementById("rules");
  var rulesText = document.getElementById("rules-text");

  var sheets = [];   // описание листов-дат, приходит из Apps Script
  var rules = [];    // абзацы текста правил с листа «Правила»
  var current = null; // выбранный лист

  var GENDER_NAMES = { "м": "Муж.", "ж": "Жен." };
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
      datesBox.appendChild(el("p", { class: "muted", text: "Сейчас нет открытых дат для записи." }));
      return;
    }
    sheets.forEach(function (s, i) {
      var input = el("input", { type: "radio", name: "sheet", value: String(i) });
      input.addEventListener("change", function () { selectSheet(i); });
      var card = el("span", { class: "date" }, [el("b", { text: s.date })]);
      if (s.label) card.appendChild(el("span", { class: "label", text: s.label }));
      datesBox.appendChild(el("label", {}, [input, card]));
    });
    if (sheets.length === 1) {
      datesBox.querySelector("input").checked = true;
      selectSheet(0);
    }
  }

  function selectSheet(i) {
    // Сохраняем уже введённые значения, если такие же поля есть на другой дате.
    var prev = current ? collect() : {};
    current = sheets[i];
    hideMessage();
    renderFields(prev);
    submitBtn.hidden = false;
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
        : el("label", { for: id }, [el("span", { text: caption(f.label) }), control]);
      if (f.kind === "uin") {
        wrap.appendChild(el("small", { class: "muted hint", text: "Номер из личного кабинета на gto.ru" }));
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
    return el("fieldset", {}, [el("legend", { text: caption(f.label) }), group]);
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
      else if (f.kind === "uin" && !UIN_RE.test(v)) problem = "УИН в формате 00-00-0000000";
      else if (f.kind === "fio" && v.split(" ").length < 2) problem = "укажите фамилию и имя";
      if (problem) {
        errors.push(problem);
        var node = document.getElementById("f" + i);
        if (node && node.tagName !== "DIV") node.classList.add("invalid");
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
    fetch(SCRIPT_URL)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error);
        sheets = res.sheets || [];
        rules = res.rules || [];
        renderDates();
      })
      .catch(function () {
        datesBox.innerHTML = "";
        showMessage("Не удалось загрузить даты сдачи. Обновите страницу.", "err");
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

    var rulesField = current.fields.filter(function (f) { return f.kind === "rules"; })[0];
    if (rulesField) {
      openRules(function () {
        values[rulesField.label] = true;
        send(values);
      });
    } else {
      send(values);
    }
  });

  /* ---------- Окно с правилами ---------- */

  var onAccept = null;

  function openRules(callback) {
    onAccept = callback;
    rulesText.innerHTML = "";
    var list = null;
    (rules.length ? rules : ["Текст правил скоро появится."]).forEach(function (line) {
      // Строки, начинающиеся с «-» или «•», показываем списком.
      var item = /^[-•–]\s*(.+)$/s.exec(line);
      if (item) {
        if (!list) list = rulesText.appendChild(el("ul"));
        list.appendChild(el("li", { text: item[1] }));
      } else {
        list = null;
        rulesText.appendChild(el("p", { text: line }));
      }
    });
    rulesText.scrollTop = 0;
    rulesDialog.showModal();
  }

  document.getElementById("rules-accept").addEventListener("click", function () {
    rulesDialog.close();
    var cb = onAccept;
    onAccept = null;
    if (cb) cb();
  });

  document.getElementById("rules-cancel").addEventListener("click", function () {
    onAccept = null;
    rulesDialog.close();
  });

  rulesDialog.addEventListener("cancel", function () { onAccept = null; });

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
    confirmDialog.showModal();
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

  function send(values, update) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Отправка…";

    // text/plain — чтобы браузер не отправлял preflight-запрос, который Apps Script не поддерживает.
    fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ sheet: current.sheet, values: values, update: !!update }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          var fio = values[(current.fields.filter(function (f) { return f.kind === "fio"; })[0] || {}).label] || "Участник";
          showMessage(res.updated
            ? "Данные участника " + fio + " на " + res.title + " обновлены. Номер в списке: " + res.number + "."
            : fio + " записан(а) на " + res.title + ". Номер в списке: " + res.number + ".", "ok");
          renderFields({});
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
        submitBtn.disabled = false;
        submitBtn.textContent = "Зарегистрироваться";
      });
  }

  load();
})();
