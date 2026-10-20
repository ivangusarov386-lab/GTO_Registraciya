(function () {
  "use strict";

  var SCRIPT_URL = (window.GTO_CONFIG && window.GTO_CONFIG.SCRIPT_URL) || "";
  var UIN_RE = /^\d{2}-\d{2}-\d{7}$/;

  var form = document.getElementById("form");
  var dateSel = document.getElementById("date");
  var gradeSel = document.getElementById("grade");
  var stageSel = document.getElementById("stage");
  var uinInput = document.getElementById("uin");
  var letterInput = document.getElementById("letter");
  var submitBtn = document.getElementById("submit");
  var message = document.getElementById("message");

  for (var g = 1; g <= 11; g++) {
    gradeSel.add(new Option(g + " класс", g));
  }

  // Подсказка ступени по классу (обычный возраст ученика); можно изменить вручную.
  var STAGE_BY_GRADE = { 1: 1, 2: 2, 3: 2, 4: 3, 5: 3, 6: 4, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6 };
  gradeSel.addEventListener("change", function () {
    var s = STAGE_BY_GRADE[gradeSel.value];
    if (s) stageSel.value = String(s);
  });

  // Маска УИН: 00-00-0000000
  uinInput.addEventListener("input", function () {
    var d = uinInput.value.replace(/\D/g, "").slice(0, 11);
    var out = d.slice(0, 2);
    if (d.length > 2) out += "-" + d.slice(2, 4);
    if (d.length > 4) out += "-" + d.slice(4);
    uinInput.value = out;
  });

  letterInput.addEventListener("input", function () {
    letterInput.value = letterInput.value.replace(/[^а-яё]/gi, "").toUpperCase().slice(0, 1);
  });

  function showMessage(text, kind) {
    message.textContent = text;
    message.className = "message " + kind;
    message.hidden = false;
  }

  function loadDates() {
    if (!SCRIPT_URL) {
      dateSel.innerHTML = '<option value="">Сайт не настроен</option>';
      showMessage("Не указан адрес Google Apps Script в config.js.", "err");
      return;
    }
    fetch(SCRIPT_URL + "?action=dates")
      .then(function (r) { return r.json(); })
      .then(function (res) {
        dateSel.innerHTML = "";
        if (!res.dates || !res.dates.length) {
          dateSel.add(new Option("Нет доступных дат", ""));
          return;
        }
        dateSel.add(new Option("Выберите дату", ""));
        res.dates.forEach(function (d) { dateSel.add(new Option(d, d)); });
        if (res.dates.length === 1) dateSel.value = res.dates[0];
      })
      .catch(function () {
        dateSel.innerHTML = '<option value="">Ошибка загрузки</option>';
        showMessage("Не удалось загрузить даты сдачи. Обновите страницу.", "err");
      });
  }

  function collect() {
    var fd = new FormData(form);
    return {
      date: fd.get("date") || "",
      fio: String(fd.get("fio") || "").replace(/\s+/g, " ").trim(),
      uin: String(fd.get("uin") || "").trim(),
      stage: fd.get("stage") || "",
      gender: fd.get("gender") || "",
      grade: fd.get("grade") || "",
      letter: String(fd.get("letter") || "").trim().toUpperCase(),
    };
  }

  function validate(p) {
    var errors = [];
    function bad(id, text) {
      errors.push(text);
      var el = document.getElementById(id);
      if (el) el.classList.add("invalid");
    }
    form.querySelectorAll(".invalid").forEach(function (el) { el.classList.remove("invalid"); });

    if (!p.date) bad("date", "выберите дату сдачи");
    if (p.fio.split(" ").length < 2) bad("fio", "укажите фамилию и имя");
    if (!UIN_RE.test(p.uin)) bad("uin", "УИН в формате 00-00-0000000");
    if (!p.grade) bad("grade", "выберите класс");
    if (!/^[А-ЯЁ]$/.test(p.letter)) bad("letter", "укажите букву класса");
    if (!p.stage) bad("stage", "выберите ступень");
    if (!p.gender) errors.push("укажите пол");
    return errors;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var p = collect();
    var errors = validate(p);
    if (errors.length) {
      showMessage("Проверьте форму: " + errors.join(", ") + ".", "err");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Отправка…";

    // text/plain — чтобы браузер не отправлял preflight-запрос, который Apps Script не поддерживает.
    fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(p),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          showMessage(p.fio + " записан(а) на " + res.date + ". Номер в списке: " + res.number + ".", "ok");
          var keepDate = dateSel.value;
          form.reset();
          dateSel.value = keepDate;
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
  });

  loadDates();
})();
