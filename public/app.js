// PreStart client script. Everything works without it; this adds helpful touches:
// clear messages for network failures, double-submit protection, confirm prompts, dialogs,
// the odometer warning, photo checks and shrinking, and showing fault details only for failed items.
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
          showNetError("That upload is too big. Use fewer photos, each 10 MB or smaller.");
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
    var rows = Array.prototype.slice.call(checkForm.querySelectorAll("[data-item]"));
    var allPass = checkForm.querySelector("[data-all-pass]");
    var progress = checkForm.querySelector("[data-progress]");
    var reportToggle = checkForm.querySelector("[data-report-toggle]");
    var reportDetail = checkForm.querySelector("[data-report-detail]");
    var vehicle = checkForm.querySelector("#f-vehicle");
    var odometer = checkForm.querySelector("#f-odometer");
    var hint = checkForm.querySelector("[data-odometer-hint]");
    var photoInputs = Array.prototype.slice.call(checkForm.querySelectorAll("[data-photo]"));
    var photoError = checkForm.querySelector("[data-photo-error]");
    var maxPhoto = Number(checkForm.getAttribute("data-max-photo")) || 10485760;
    var notes = checkForm.querySelector("#f-notes");
    var faultBoxes = Array.prototype.slice.call(checkForm.querySelectorAll("[data-faults-for]"));

    function answerOf(row) {
      var picked = row.querySelector("input[data-answer]:checked");
      return picked ? picked.value : "";
    }

    function refreshRow(row) {
      var failed = answerOf(row) === "fail";
      var detail = row.querySelector("[data-fail-detail]");
      if (detail) detail.hidden = !failed;
      var note = row.querySelector("[data-fail-note]");
      if (note) note.required = failed;
      row.querySelectorAll("input[name^=v_]").forEach(function (r) {
        r.required = failed;
      });
      row.classList.remove("ring-2", "ring-danger", "rounded-xl");
    }

    function refresh() {
      var answered = rows.filter(function (r) {
        return answerOf(r) !== "";
      }).length;
      if (progress) {
        progress.hidden = false;
        progress.textContent = answered + " of " + rows.length + " answered.";
      }
      if (allPass) allPass.hidden = answered === rows.length;
      var reporting = reportToggle && reportToggle.checked;
      if (reportDetail) reportDetail.hidden = !reporting;
      if (notes) notes.required = !!reporting;
    }

    rows.forEach(function (row) {
      row.addEventListener("change", function (e) {
        if (e.target instanceof HTMLInputElement && e.target.hasAttribute("data-answer")) {
          refreshRow(row);
          refresh();
          if (e.target.value === "fail") {
            var note = row.querySelector("[data-fail-note]");
            if (note && !note.value) note.focus({ preventScroll: true });
          }
        }
      });
      refreshRow(row);
    });
    if (reportToggle) reportToggle.addEventListener("change", refresh);
    if (allPass) {
      allPass.addEventListener("click", function () {
        rows.forEach(function (row) {
          if (answerOf(row) !== "") return;
          var pass = row.querySelector("input[data-answer][value=pass]");
          if (pass) pass.checked = true;
          refreshRow(row);
        });
        refresh();
      });
    }
    refresh();

    // Known faults for the chosen vehicle.
    function showFaults() {
      var id = vehicle ? vehicle.value : "";
      faultBoxes.forEach(function (box) {
        box.hidden = box.getAttribute("data-faults-for") !== id;
      });
    }

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
    if (vehicle) {
      vehicle.addEventListener("change", function () {
        updateHint();
        showFaults();
      });
    }
    updateHint();
    showFaults();

    // Photos: phone photos are shrunk before upload so a check with several photos stays quick on a weak signal.
    var pending = 0;
    var waiting = [];
    function settle() {
      pending -= 1;
      if (pending === 0) {
        var run = waiting;
        waiting = [];
        run.forEach(function (fn) {
          fn();
        });
      }
    }

    function shrink(file) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== "function") {
        return Promise.resolve(file);
      }
      return createImageBitmap(file)
        .then(function (bmp) {
          var max = 1600;
          var scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
          if (scale === 1 && file.size < 1500000) return file;
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(bmp.width * scale);
          canvas.height = Math.round(bmp.height * scale);
          canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
          return new Promise(function (resolve) {
            canvas.toBlob(
              function (blob) {
                if (!blob || blob.size >= file.size) return resolve(file);
                var name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
                resolve(new File([blob], name, { type: "image/jpeg" }));
              },
              "image/jpeg",
              0.82,
            );
          });
        })
        .catch(function () {
          return file;
        });
    }

    function photoProblem() {
      for (var i = 0; i < photoInputs.length; i++) {
        var input = photoInputs[i];
        var max = Number(input.getAttribute("data-max-files")) || 3;
        var files = input.files ? Array.prototype.slice.call(input.files) : [];
        if (files.length > max) return { input: input, message: "Choose up to " + max + " photos here." };
        for (var j = 0; j < files.length; j++) {
          if (files[j].size > maxPhoto) {
            return { input: input, message: "A photo is too big. Each photo must be 10 MB or smaller." };
          }
        }
      }
      return null;
    }

    function showPhotoProblem() {
      var problem = photoProblem();
      if (!photoError) return problem;
      photoError.textContent = problem ? problem.message : "";
      photoError.classList.toggle("hidden", !problem);
      return problem;
    }

    photoInputs.forEach(function (input) {
      input.addEventListener("change", function () {
        var files = input.files ? Array.prototype.slice.call(input.files) : [];
        if (!files.length || typeof DataTransfer !== "function") {
          showPhotoProblem();
          return;
        }
        pending += 1;
        Promise.all(files.map(shrink))
          .then(function (smaller) {
            try {
              var dt = new DataTransfer();
              smaller.forEach(function (f) {
                dt.items.add(f);
              });
              input.files = dt.files;
            } catch {
              // Older browsers cannot replace the chosen files; the originals are sent instead.
            }
          })
          .then(function () {
            showPhotoProblem();
            settle();
          });
      });
    });

    checkForm.addEventListener(
      "submit",
      function (e) {
        if (pending > 0) {
          e.preventDefault();
          waiting.push(function () {
            if (typeof checkForm.requestSubmit === "function") checkForm.requestSubmit();
          });
          return;
        }
        var missing = rows.filter(function (r) {
          return answerOf(r) === "";
        });
        if (missing.length) {
          e.preventDefault();
          missing.forEach(function (r) {
            r.classList.add("ring-2", "ring-danger", "rounded-xl");
          });
          showNetError(
            missing.length === 1
              ? "One item has no answer yet. Mark it Pass, Fail or N/A."
              : missing.length + " items have no answer yet. Mark each one Pass, Fail or N/A.",
          );
          missing[0].scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
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
        var problem = showPhotoProblem();
        if (problem) {
          e.preventDefault();
          problem.input.focus();
        }
      },
      true,
    );
  }
})();
