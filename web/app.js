(function () {
  "use strict";

  // ---- Loading screen ----
  var loaderMessages = [
    "Načítám zakázky…",
    "Připravuji evidenci…",
    "Synchronizuji zákazníky…",
    "Kontroluji sklad…",
    "Skoro připraveno…",
  ];
  var loaderEl = document.getElementById("page-loader");
  var loaderMsgEl = document.getElementById("loader-msg");
  var loaderBarEl = document.getElementById("loader-bar-fill");
  var loaderStart = Date.now();
  var loaderMinMs = 1600;
  var loaderMsgIdx = 0;
  var loaderMsgInterval = setInterval(function () {
    loaderMsgIdx = (loaderMsgIdx + 1) % loaderMessages.length;
    if (loaderMsgEl) {
      loaderMsgEl.style.opacity = "0";
      setTimeout(function () {
        loaderMsgEl.textContent = loaderMessages[loaderMsgIdx];
        loaderMsgEl.style.opacity = "1";
      }, 130);
    }
    if (loaderBarEl) {
      var pct = Math.min(95, Math.round((loaderMsgIdx / (loaderMessages.length - 1)) * 90) + 10);
      loaderBarEl.style.width = pct + "%";
    }
  }, 380);

  function hideLoader() {
    clearInterval(loaderMsgInterval);
    if (loaderBarEl) loaderBarEl.style.width = "100%";
    setTimeout(function () {
      if (loaderEl) {
        loaderEl.classList.add("loader-out");
        setTimeout(function () { if (loaderEl) loaderEl.remove(); }, 460);
      }
    }, 200);
  }

  window.addEventListener("load", function () {
    var elapsed = Date.now() - loaderStart;
    var wait = Math.max(0, loaderMinMs - elapsed);
    setTimeout(hideLoader, wait);
  });

  var GITHUB_RELEASE = "https://api.github.com/repos/alexpapillier-lab/jobi/releases/latest";

  // ---- Mockup scroll parallax + rotation ----
  var mockupWin = document.querySelector(".mockup-window");
  var heroEl = document.querySelector(".hero");
  if (mockupWin && heroEl && window.innerWidth > 920) {
    mockupWin.style.willChange = "transform";
    function updateMockup() {
      var heroH = heroEl.offsetHeight;
      var scrollY = window.scrollY;
      var p = Math.min(1, scrollY / (heroH * 0.75));
      var ease = 1 - Math.pow(1 - p, 2); // ease-out
      var ry = -5 + ease * 5;       // -5° → 0°
      var rx = 1.5 - ease * 1.5;    // 1.5° → 0°
      var sc = 0.97 + ease * 0.03;  // 0.97 → 1.0
      var ty = -scrollY * 0.06;     // parallax up
      mockupWin.style.transform =
        "perspective(1200px) translateY(" + ty + "px) rotateY(" + ry + "deg) rotateX(" + rx + "deg) scale(" + sc + ")";
    }
    window.addEventListener("scroll", updateMockup, { passive: true });
    updateMockup();
  }

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

  // Ikony – stejné jako v Jobi (DeviceIcon, WrenchIcon)
  var deviceIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><path d="M12 18h.01"/></svg>';
  var wrenchIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';

  // ---- Demo: zakázky 1:1 jako Jobi OrderRow ----
  var statuses = [
    { key: "received", label: "Přijato", bg: "rgba(59, 130, 246, 0.5)", fg: "#1d4ed8" },
    { key: "in_repair", label: "V opravě", bg: "rgba(234, 179, 8, 0.4)", fg: "#a16207" },
    { key: "done", label: "Hotovo", bg: "rgba(34, 197, 94, 0.4)", fg: "#15803d" },
  ];
  var orders = [
    { id: "1", code: "J-28A99Z", date: "7. 3. 2026", statusKey: "received", device: "iPhone 14 Pro", customer: "Jan Novák", repair: "Výměna displeje", price: 2490 },
    { id: "2", code: "J-28A98Y", date: "6. 3. 2026", statusKey: "in_repair", device: "Samsung Galaxy S24", customer: "Marie Svobodová", repair: "Výměna baterie", price: 890 },
    { id: "3", code: "J-28A97X", date: "5. 3. 2026", statusKey: "done", device: "MacBook Pro 14\"", customer: "Petr Novotný", repair: "Čištění + pasta", price: 1200 },
    { id: "4", code: "J-28A96W", date: "4. 3. 2026", statusKey: "received", device: "iPad Air", customer: "Eva Černá", repair: "Rozbitý displej", price: 3200 },
    { id: "5", code: "J-28A95V", date: "3. 3. 2026", statusKey: "in_repair", device: "iPhone 13", customer: "Tomáš Dvořák", repair: "Výměna baterie + čištění", price: 1500 },
  ];

  function getStatus(key) {
    return statuses.find(function (s) { return s.key === key; }) || statuses[0];
  }

  function renderOrderRow(order) {
    var meta = getStatus(order.statusKey);
    var border = meta.bg ? "2px solid " + meta.bg.replace(/[\d.]+\)$/, "0.5)") : "1px solid var(--border)";
    var bg = meta.bg ? meta.bg.replace(/[\d.]+\)$/, "0.3)") : "var(--panel)";
    var leftBar = meta.bg || "var(--border)";
    var shadow = meta.bg ? "0 4px 16px " + meta.bg.replace(/[\d.]+\)$/, "0.25)") + ", 0 0 0 1px " + meta.bg.replace(/[\d.]+\)$/, "0.15)") : "var(--shadow-soft)";
    var barShadow = meta.bg ? "0 0 24px " + meta.bg.replace(/[\d.]+\)$/, "0.4)") : "none";
    var statusOpts = statuses.map(function (s) {
      return "<option value=\"" + s.key + "\"" + (s.key === order.statusKey ? " selected" : "") + ">" + s.label + "</option>";
    }).join("");
    var finalBadge = meta.key === "done" ? '<span class="demo-order-final">✓</span>' : "";
    return (
      '<div class="demo-order-row status-' + meta.key + '" data-id="' + order.id + '" data-code="' + order.code + '" data-customer="' + order.customer + '" data-device="' + order.device + '" data-repair="' + order.repair + '" style="border:' + border + ";background:" + bg + ";box-shadow:" + shadow + ';">' +
        '<div class="demo-order-bar" style="background:' + leftBar + ";box-shadow:" + barShadow + ';"></div>' +
        '<div class="demo-order-inner">' +
          '<div class="demo-order-head">' +
            '<div class="demo-order-head-left">' +
              '<span class="demo-order-code">' + order.code + '</span>' +
              '<span class="demo-order-date">' + order.date + '</span>' +
              finalBadge +
            '</div>' +
            '<div class="demo-order-status-wrap" onclick="event.stopPropagation()">' +
              '<select class="demo-order-status" data-id="' + order.id + '">' + statusOpts + '</select>' +
            '</div>' +
          '</div>' +
          '<div class="demo-order-body">' +
            '<div class="demo-order-device-row">' +
              '<div class="demo-order-device-icon">' + deviceIconSvg + '</div>' +
              '<div class="demo-order-device-text">' +
                '<div class="demo-order-device">' + order.device + '</div>' +
                '<div class="demo-order-customer">' + order.customer + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="demo-order-repair-row">' +
              '<div class="demo-order-wrench-icon">' + wrenchIconSvg + '</div>' +
              '<div class="demo-order-repair-text">' + order.repair + '</div>' +
            '</div>' +
            (order.price ? '<div class="demo-order-price-box"><span class="demo-order-price">' + order.price.toLocaleString("cs-CZ") + ' Kč</span></div>' : '') +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  var ordersEl = document.getElementById("demo-orders");
  if (ordersEl) {
    ordersEl.innerHTML = orders.map(renderOrderRow).join("");

    ordersEl.addEventListener("click", function (e) {
      var row = e.target.closest(".demo-order-row");
      if (!row) return;
      var detail = document.getElementById("demo-detail");
      document.getElementById("demo-detail-code").textContent = row.getAttribute("data-code");
      document.getElementById("demo-detail-customer").textContent = row.getAttribute("data-customer");
      document.getElementById("demo-detail-device").textContent = row.getAttribute("data-device");
      document.getElementById("demo-detail-repair").textContent = row.getAttribute("data-repair");
      detail.hidden = false;
    });

    ordersEl.addEventListener("change", function (e) {
      var select = e.target;
      if (!select.classList.contains("demo-order-status")) return;
      var id = select.getAttribute("data-id");
      var key = select.value;
      var order = orders.find(function (o) { return o.id === id; });
      if (!order) return;
      order.statusKey = key;
      var row = ordersEl.querySelector('.demo-order-row[data-id="' + id + '"]');
      if (row) {
        var meta = getStatus(key);
        var border = meta.bg ? "2px solid " + meta.bg.replace(/[\d.]+\)$/, "0.5)") : "1px solid var(--border)";
        var bg = meta.bg ? meta.bg.replace(/[\d.]+\)$/, "0.3)") : "var(--panel)";
        var leftBar = meta.bg || "var(--border)";
        var shadow = meta.bg ? "0 4px 16px " + meta.bg.replace(/[\d.]+\)$/, "0.25)") + ", 0 0 0 1px " + meta.bg.replace(/[\d.]+\)$/, "0.15)") : "var(--shadow-soft)";
        var barShadow = meta.bg ? "0 0 24px " + meta.bg.replace(/[\d.]+\)$/, "0.4)") : "none";
        row.className = "demo-order-row status-" + key;
        row.style.border = border;
        row.style.background = bg;
        row.style.boxShadow = shadow;
        row.querySelector(".demo-order-bar").style.background = leftBar;
        row.querySelector(".demo-order-bar").style.boxShadow = barShadow;
        var headLeft = row.querySelector(".demo-order-head-left");
        var finalSpan = row.querySelector(".demo-order-final");
        if (key === "done") {
          if (!finalSpan) {
            var span = document.createElement("span");
            span.className = "demo-order-final";
            span.textContent = "✓";
            headLeft.appendChild(span);
          }
        } else if (finalSpan) finalSpan.remove();
      }
      if (key === "done") showToast("Zakázka " + order.code + " dokončena");
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
