(function () {
  "use strict";

  var GITHUB_RELEASE = "https://api.github.com/repos/alexpapillier-lab/jobi/releases/latest";

  // ---- Scroll reveal ----
  var reveals = document.querySelectorAll(".reveal, .feature-card");
  function reveal() {
    reveals.forEach(function (el) {
      var top = el.getBoundingClientRect().top;
      if (top < window.innerHeight - 80) el.classList.add("visible");
    });
  }
  window.addEventListener("scroll", reveal);
  window.addEventListener("load", reveal);
  reveal();

  // ---- Demo: zakázky (stejný vzhled jako Jobi) ----
  var statuses = [
    { key: "received", label: "Přijato", bg: "rgba(59, 130, 246, 0.5)", fg: "#1d4ed8" },
    { key: "in_repair", label: "V opravě", bg: "rgba(234, 179, 8, 0.4)", fg: "#a16207" },
    { key: "done", label: "Hotovo", bg: "rgba(34, 197, 94, 0.4)", fg: "#15803d" },
  ];
  var orders = [
    { id: "1", code: "J-28A99Z", date: "7. 3. 2026", statusKey: "received", device: "iPhone 14 Pro", customer: "Jan Novák", repair: "Výměna displeje", price: 2490 },
    { id: "2", code: "J-28A98Y", date: "6. 3. 2026", statusKey: "in_repair", device: "Samsung Galaxy S24", customer: "Marie Svobodová", repair: "Výměna baterie", price: 890 },
    { id: "3", code: "J-28A97X", date: "5. 3. 2026", statusKey: "done", device: "MacBook Pro 14\"", customer: "Petr Novotný", repair: "Čištění + pasta", price: 1200 },
  ];

  function getStatus(key) {
    return statuses.find(function (s) { return s.key === key; }) || statuses[0];
  }

  function renderOrderRow(order) {
    var meta = getStatus(order.statusKey);
    var border = meta.bg ? "2px solid " + meta.bg.replace("0.5", "0.5") : "1px solid var(--border)";
    var bg = meta.bg ? meta.bg.replace("0.5", "0.3") : "var(--panel)";
    var leftBar = meta.bg || "var(--border)";
    var statusOpts = statuses.map(function (s) {
      return "<option value=\"" + s.key + "\"" + (s.key === order.statusKey ? " selected" : "") + ">" + s.label + "</option>";
    }).join("");
    return (
      "<div class=\"demo-order-row\" data-id=\"" + order.id + "\" style=\"border:" + border + ";background:" + bg + ";\" data-code=\"" + order.code + "\" data-customer=\"" + order.customer + "\" data-device=\"" + order.device + "\" data-repair=\"" + order.repair + "\">" +
        "<div class=\"demo-order-bar\" style=\"background:" + leftBar + "\"></div>" +
        "<div class=\"demo-order-inner\">" +
          "<div class=\"demo-order-head\">" +
            "<span class=\"demo-order-code\">" + order.code + "</span>" +
            "<span class=\"demo-order-date\">" + order.date + "</span>" +
            (meta.key === "done" ? "<span class=\"demo-order-final\">✓</span>" : "") +
            "<div class=\"demo-order-status-wrap\" onclick=\"event.stopPropagation()\">" +
              "<select class=\"demo-order-status\" data-id=\"" + order.id + "\">" + statusOpts + "</select>" +
            "</div>" +
          "</div>" +
          "<div class=\"demo-order-body\">" +
            "<div class=\"demo-order-device\">" + order.device + "</div>" +
            "<div class=\"demo-order-customer\">" + order.customer + "</div>" +
            "<div class=\"demo-order-repair\">" + order.repair + "</div>" +
            (order.price ? "<div class=\"demo-order-price\">" + order.price.toLocaleString("cs-CZ") + " Kč</div>" : "") +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  var ordersEl = document.getElementById("demo-orders");
  if (ordersEl) {
    ordersEl.innerHTML = orders.map(renderOrderRow).join("");

    ordersEl.addEventListener("click", function (e) {
      var row = e.target.closest(".demo-order-row");
      if (!row) return;
      var id = row.getAttribute("data-id");
      var detail = document.getElementById("demo-detail");
      document.getElementById("demo-detail-code").textContent = row.getAttribute("data-code");
      document.getElementById("demo-detail-customer").textContent = row.getAttribute("data-customer");
      document.getElementById("demo-detail-device").textContent = row.getAttribute("data-device");
      document.getElementById("demo-detail-repair").textContent = row.getAttribute("data-repair");
      detail.hidden = false;
    });

    ordersEl.addEventListener("change", function (e) {
      var select = e.target;
      if (select.classList.contains("demo-order-status")) {
        var id = select.getAttribute("data-id");
        var key = select.value;
        var order = orders.find(function (o) { return o.id === id; });
        if (order) {
          order.statusKey = key;
          var row = ordersEl.querySelector(".demo-order-row[data-id=\"" + id + "\"]");
          if (row) {
            var meta = getStatus(key);
            row.style.border = meta.bg ? "2px solid " + (meta.bg.replace("0.4", "0.5").replace("0.5", "0.5")) : "1px solid var(--border)";
            row.style.background = meta.bg ? meta.bg.replace("0.4", "0.3").replace("0.5", "0.3") : "var(--panel)";
            row.querySelector(".demo-order-bar").style.background = meta.bg || "var(--border)";
            var finalSpan = row.querySelector(".demo-order-final");
            if (key === "done") {
              if (!finalSpan) {
                var head = row.querySelector(".demo-order-head");
                var span = document.createElement("span");
                span.className = "demo-order-final";
                span.textContent = "✓";
                head.insertBefore(span, head.querySelector(".demo-order-status-wrap"));
              }
            } else if (finalSpan) finalSpan.remove();
          }
          if (key === "done") showToast("Zakázka " + order.code + " dokončena");
        }
      }
    });
  }

  var detailClose = document.getElementById("demo-detail-close");
  if (detailClose) {
    detailClose.addEventListener("click", function () {
      document.getElementById("demo-detail").hidden = true;
    });
  }

  function showToast(message) {
    var el = document.getElementById("demo-toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("demo-toast-visible");
    setTimeout(function () { el.classList.remove("demo-toast-visible"); }, 3000);
  }

  // ---- Stáhnout Jobi + JobiDocs DMG z GitHub ----
  var downloadBtn = document.getElementById("download-macos-btn");
  var downloadLoading = document.getElementById("download-loading");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", function () {
      downloadBtn.disabled = true;
      if (downloadLoading) downloadLoading.hidden = false;
      fetch(GITHUB_RELEASE)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var assets = (data.assets || []).filter(function (a) {
            var n = (a.name || "").toLowerCase();
            return n.endsWith(".dmg");
          });
          var jobiDmg = assets.find(function (a) {
            var n = (a.name || "").toLowerCase();
            return n.startsWith("jobi") && n.endsWith(".dmg") && n.indexOf("jobidocs") === -1;
          });
          var jobidocsDmg = assets.find(function (a) {
            var n = (a.name || "").toLowerCase();
            return n.indexOf("jobidocs") !== -1 && n.endsWith(".dmg");
          });
          if (jobiDmg && jobiDmg.browser_download_url) {
            window.location.href = jobiDmg.browser_download_url;
          }
          if (jobidocsDmg && jobidocsDmg.browser_download_url) {
            setTimeout(function () {
              window.location.href = jobidocsDmg.browser_download_url;
            }, 400);
          }
          if (!jobiDmg && !jobidocsDmg) {
            window.open("https://github.com/alexpapillier-lab/jobi/releases/latest", "_blank");
          }
        })
        .catch(function () {
          window.open("https://github.com/alexpapillier-lab/jobi/releases/latest", "_blank");
        })
        .finally(function () {
          downloadBtn.disabled = false;
          if (downloadLoading) downloadLoading.hidden = true;
        });
    });
  }

  var heroDownload = document.querySelector(".btn-download-hero");
  if (heroDownload && downloadBtn) {
    heroDownload.addEventListener("click", function (e) {
      e.preventDefault();
      downloadBtn.click();
    });
  }
})();
