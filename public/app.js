// PreStart client script. Everything works without it; this adds helpful touches:
// clear messages for network failures, double-submit protection, confirm prompts, dialogs,
// the odometer warning, the photo size check, and showing the problem section only when needed.
(function () {
  "use strict";

  var netBox = document.getElementById("net-error");

  function showNetError(message) {
    if (!netBox) return alert(message);
    netBox.innerHTML = "";
    var div = document.createElement("div");
    div.className = "rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger";
    div.textContent = message;
    netBox.appendChild(div);
    netBox.classList.remove("hidden");
    netBox.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Confirm prompts on buttons with data-confirm.
  document.addEventListener(
    "click",
    function (e) {
      var el = e.target instanceof Element ? e.target.closest("[data-confirm]") : null;
      if (el && !window.confirm(el.getAttribute("data-confirm") || "Are you sure?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  // Dialogs: links with data-open-dialog open the matching <dialog>; without JS they go to a full page.
  document.addEventListener("click", function (e) {
    var t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    var opener = t.closest("[data-open-dialog]");
    if (opener) {
      var d = document.getElementById(opener.getAttribute("data-open-dialog"));
      if (d && typeof d.showModal === "function") {
        e.preventDefault();
        d.showModal();
        var first = d.querySelector("input:not([type=hidden]), select, textarea");
        if (first) first.focus();
      }
      return;
    }
    if (t.closest("[data-close-dialog]")) {
      var dlg = t.closest("dialog");
      if (dlg) dlg.close();
    }
  });

  // Enhanced form submits: one submit at a time, and a clear message when the network fails.
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute("data-enhance")) return;
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (form.dataset.busy === "1") return;

    if (!navigator.onLine) {
      showNetError(
        "You are offline, so this was not sent. Your answers are still here. Try again when you have signal.",
      );
      return;
    }
    var submitter = e.submitter;
    var data = new FormData(form);
    if (submitter && submitter.name) data.append(submitter.name, submitter.value);

    form.dataset.busy = "1";
    var buttons = form.querySelectorAll("button[type=submit], button:not([type])");
    buttons.forEach(function (b) {
      b.disabled = true;
    });
    var label = submitter ? submitter.textContent : "";
    if (submitter) submitter.textContent = "Sending...";

    function reset() {
      form.dataset.busy = "";
      buttons.forEach(function (b) {
        b.disabled = false;
      });
      if (submitter) submitter.textContent = label;
    }

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, 60000);

    fetch(form.getAttribute("action") || window.location.href, {
      method: (form.getAttribute("method") || "post").toUpperCase(),
      body: data,
      credentials: "same-origin",
      redirect: "follow",
      signal: controller ? controller.signal : undefined,
      headers: { "X-Requested-With": "fetch" },
    })
      .then(function (res) {
        clearTimeout(timer);
        if (res.status === 413) {
          reset();
          showNetError("That upload is too big. Photos must be 10 MB or smaller.");
          return;
        }
        if (res.redirected) {
          window.location.assign(res.url);
          return;
        }
        return res.text().then(function (html) {
          document.open();
          document.write(html);
          document.close();
          window.scrollTo(0, 0);
        });
      })
      .catch(function () {
        clearTimeout(timer);
        reset();
        showNetError(
          "We could not reach the server, so this was not sent. Your answers are still here. Check your signal and try again.",
        );
      });
  });

  // ---------- Check form ----------
  var checkForm = document.querySelector("[data-check-form]");
  if (checkForm) {
    var items = Array.prototype.slice.call(checkForm.querySelectorAll("[data-check-item]"));
    var problemCard = document.getElementById("problem");
    var anyway = checkForm.querySelector("[data-report-anyway]");
    var anywayToggle = checkForm.querySelector("[data-report-toggle]");
    var tickAll = checkForm.querySelector("[data-tick-all]");
    var vehicle = checkForm.querySelector("#f-vehicle");
    var odometer = checkForm.querySelector("#f-odometer");
    var hint = checkForm.querySelector("[data-odometer-hint]");
    var photo = checkForm.querySelector("[data-photo]");
    var photoError = checkForm.querySelector("[data-photo-error]");
    var maxPhoto = Number(checkForm.getAttribute("data-max-photo")) || 10485760;
    var notes = checkForm.querySelector("#f-notes");

    function refresh() {
      var allOk = items.every(function (i) {
        return i.checked;
      });
      var wantsReport = anywayToggle && anywayToggle.checked;
      if (anyway) anyway.hidden = !allOk;
      var showProblem = !allOk || (allOk && wantsReport);
      if (problemCard) problemCard.hidden = !showProblem;
      if (notes) notes.required = showProblem;
      if (tickAll) tickAll.hidden = allOk;
    }
    items.forEach(function (i) {
      i.addEventListener("change", refresh);
    });
    if (anywayToggle) anywayToggle.addEventListener("change", refresh);
    if (tickAll) {
      tickAll.addEventListener("click", function () {
        items.forEach(function (i) {
          i.checked = true;
        });
        refresh();
      });
    }
    refresh();

    function lastReading() {
      var opt = vehicle && vehicle.selectedOptions ? vehicle.selectedOptions[0] : null;
      return opt && opt.getAttribute("data-odometer") ? Number(opt.getAttribute("data-odometer")) : null;
    }
    function updateHint() {
      var last = lastReading();
      if (!hint) return;
      hint.textContent =
        last === null
          ? "Whole number, no commas."
          : "Last reading: " + last.toLocaleString() + ". Whole number, no commas.";
    }
    if (vehicle) vehicle.addEventListener("change", updateHint);
    updateHint();

    checkForm.addEventListener(
      "submit",
      function (e) {
        var last = lastReading();
        var value = odometer ? Number(odometer.value) : NaN;
        var confirmBox = checkForm.querySelector("input[name=confirmLower]");
        if (last !== null && !isNaN(value) && value < last && !(confirmBox && confirmBox.checked)) {
          var ok = window.confirm(
            "This reading (" +
              value.toLocaleString() +
              ") is lower than the last one (" +
              last.toLocaleString() +
              "). Is it right?",
          );
          if (!ok) {
            e.preventDefault();
            odometer.focus();
            return;
          }
          var hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.name = "confirmLower";
          hidden.value = "1";
          checkForm.appendChild(hidden);
        }
        if (photo && photo.files && photo.files[0] && photo.files[0].size > maxPhoto) {
          e.preventDefault();
          if (photoError) {
            photoError.textContent =
              "That photo is too big. Photos must be 10 MB or smaller. Choose a smaller one or leave it out.";
            photoError.classList.remove("hidden");
          }
          photo.focus();
        }
      },
      true,
    );

    if (photo) {
      photo.addEventListener("change", function () {
        if (!photoError) return;
        var f = photo.files && photo.files[0];
        if (f && f.size > maxPhoto) {
          photoError.textContent = "That photo is too big. Photos must be 10 MB or smaller.";
          photoError.classList.remove("hidden");
        } else {
          photoError.textContent = "";
          photoError.classList.add("hidden");
        }
      });
    }
  }
})();
