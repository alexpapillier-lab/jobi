(function () {
  "use strict";

  // ---- Loading screen ----
  var loaderMessages = [
    "Připravuji stránku…",
    "Načítám komponenty…",
    "Skoro hotovo…",
  ];
  var loaderEl = document.getElementById("page-loader");
  var loaderMsgEl = document.getElementById("loader-msg");
  var loaderBarEl = document.getElementById("loader-bar-fill");
  var loaderStart = Date.now();
  /* Loader držel stránku minimálně 1,8 s i tehdy, když bylo dávno načteno.
     Ta doba nikomu nic nepřinesla, jen zdržela. 300 ms stačí na to, aby
     přechod nebyl trhnutí. */
  var loaderMinMs = 300;
  var loaderMsgIdx = 0;

  function setLoaderMsg(text, barPct) {
    if (!loaderMsgEl) return;
    loaderMsgEl.style.opacity = "0";
    if (loaderBarEl && barPct !== undefined) loaderBarEl.style.width = barPct + "%";
    setTimeout(function () {
      if (loaderMsgEl) {
        loaderMsgEl.textContent = text;
        loaderMsgEl.style.opacity = "1";
      }
    }, 220);
  }

  // Single interval – no race conditions
  var loaderMsgInterval = setInterval(function () {
    loaderMsgIdx++;
    if (loaderMsgIdx >= loaderMessages.length) {
      clearInterval(loaderMsgInterval);
      return;
    }
    var pct = Math.round((loaderMsgIdx / (loaderMessages.length - 1)) * 75) + 20;
    setLoaderMsg(loaderMessages[loaderMsgIdx], pct);
  }, 750);

  function hideLoader() {
    clearInterval(loaderMsgInterval);
    if (loaderBarEl) loaderBarEl.style.width = "100%";
    setTimeout(function () {
      if (loaderEl) {
        loaderEl.classList.add("loader-out");
        setTimeout(function () { if (loaderEl) loaderEl.remove(); }, 500);
      }
    }, 120); // Jen aby stihl doběhnout pruh na 100 %. Dřív 320 ms – další zdržení navíc.
  }

  window.addEventListener("load", function () {
    var elapsed = Date.now() - loaderStart;
    var wait = Math.max(0, loaderMinMs - elapsed);
    setTimeout(hideLoader, wait);
  });

  var GITHUB_RELEASE = "https://api.github.com/repos/alexpapillier-lab/jobi/releases/latest";

  // ---- Mockup scroll parallax + rotation ----
  /* Komu se z pohybu dělá špatně, ten si omezený pohyb zapne v systému.
     Parallax s otáčením je ozdoba, takže se prostě nespustí. */
  var omezenyPohyb = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var mockupWin = document.querySelector(".mockup-window");
  var heroEl = document.querySelector(".hero");
  if (mockupWin && heroEl && window.innerWidth > 920 && !omezenyPohyb) {
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
  /* Od téhle chvíle má rozsvěcení obsahu na starosti skript. Dokud tu třída
     není, style.css obsah po třech vteřinách zobrazí sám – viz nouzové
     animace na konci style.css. */
  document.documentElement.classList.add("js");

  // ---- Pricing toggle (měsíčně / ročně) ----
  var pricingToggle = document.getElementById("pricing-toggle");
  if (pricingToggle) {
    var monthlyEls = document.querySelectorAll(".pricing-monthly");
    var yearlyEls = document.querySelectorAll(".pricing-yearly");
    var priceEls = document.querySelectorAll(".pricing-price");
    var labelMonthly = document.querySelector(".pricing-toggle-label[data-period='monthly']");
    var labelYearly = document.querySelector(".pricing-toggle-label[data-period='yearly']");
    var yearlyActive = false;
    var toggling = false;
    function updatePricing() {
      if (toggling) return;
      toggling = true;
      // Fade out prices
      priceEls.forEach(function (el) { el.classList.add("price-fade"); });
      setTimeout(function () {
        yearlyActive = !yearlyActive;
        pricingToggle.setAttribute("aria-checked", yearlyActive ? "true" : "false");
        pricingToggle.classList.toggle("pricing-toggle-yearly", yearlyActive);
        monthlyEls.forEach(function (el) { el.hidden = yearlyActive; });
        yearlyEls.forEach(function (el) { el.hidden = !yearlyActive; });
        if (labelMonthly) labelMonthly.classList.toggle("pricing-toggle-label-active", !yearlyActive);
        if (labelYearly) labelYearly.classList.toggle("pricing-toggle-label-active", yearlyActive);
        // Fade back in
        priceEls.forEach(function (el) { el.classList.remove("price-fade"); });
        toggling = false;
      }, 160);
    }
    pricingToggle.addEventListener("click", updatePricing);
  }

  // ---- Stáhnout Jobi nebo JobiDocs DMG z GitHub ----
  var downloadLoading = document.getElementById("download-loading");
  var downloadMsgEl = document.getElementById("download-msg");

  var NAZEV_OS = { mac: "macOS", win: "Windows" };
  var NAZEV_APP = { jobi: "Jobi", jobidocs: "JobiDocs" };

  /* Tlačítko dřív při nenalezeném instalátoru mlčky otevřelo GitHub a člověk
     tam koukal na stránku vydání bez souboru, který hledal. Radši to řekneme
     rovnou a nabídneme cestu dál. */
  function ukazZpravu(html) {
    if (!downloadMsgEl) return;
    downloadMsgEl.innerHTML = html;
    downloadMsgEl.hidden = false;
  }

  function skryjZpravu() {
    if (!downloadMsgEl) return;
    downloadMsgEl.hidden = true;
    downloadMsgEl.innerHTML = "";
  }

  function zpravaChybiVydani(which, os) {
    ukazZpravu(
      "<strong>" + NAZEV_APP[which] + " pro " + NAZEV_OS[os] + " zatím není vydaný.</strong> " +
      "V posledním vydání na GitHubu instalátor pro tenhle systém není. " +
      "Napište na <a href=\"mailto:info@appjobi.com?subject=Instal%C3%A1tor%20" + NAZEV_APP[which] + "%20pro%20" + NAZEV_OS[os] + "\">info@appjobi.com</a> " +
      "a dáme vědět, jakmile bude, nebo se podívejte na " +
      "<a href=\"https://github.com/alexpapillier-lab/jobi/releases/latest\" target=\"_blank\" rel=\"noopener\">stránku vydání</a>."
    );
  }

  function zpravaNedostupnyGitHub() {
    ukazZpravu(
      "<strong>Nepodařilo se zjistit poslední vydání.</strong> " +
      "Zkuste to za chvíli znovu, nebo otevřete " +
      "<a href=\"https://github.com/alexpapillier-lab/jobi/releases/latest\" target=\"_blank\" rel=\"noopener\">stránku vydání na GitHubu</a>."
    );
  }

  function triggerDownload(url, filename) {
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* Vybraný systém: "mac" nebo "win". Předvyplní se podle prohlížeče. */
  var selectedOS = detectOS();

  function detectOS() {
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    var ua = navigator.userAgent || "";
    if (/win/i.test(p) || /Windows/i.test(ua)) return "win";
    return "mac";
  }

  /* Najde v assetech release ten správný soubor podle systému a aplikace. */
  function findAsset(assets, which, os) {
    var ext = os === "win" ? ".exe" : ".dmg";
    return assets.find(function (a) {
      var n = (a.name || "").toLowerCase();
      if (!n.endsWith(ext)) return false;
      var isDocs = n.indexOf("jobidocs") !== -1;
      return which === "jobidocs" ? isDocs : (n.indexOf("jobi") === 0 && !isDocs);
    });
  }

  function fetchReleaseAndDownload(which, btn) {
    if (!btn) return;
    btn.disabled = true;
    skryjZpravu();
    if (downloadLoading) downloadLoading.hidden = false;
    var os = selectedOS;
    fetch(GITHUB_RELEASE)
      .then(function (r) {
        if (!r.ok) throw new Error("GitHub odpověděl " + r.status);
        return r.json();
      })
      .then(function (data) {
        var assets = data.assets || [];
        var file = findAsset(assets, which, os);
        if (file && file.browser_download_url) {
          triggerDownload(file.browser_download_url, file.name);
        } else {
          zpravaChybiVydani(which, os);
        }
      })
      .catch(function () {
        zpravaNedostupnyGitHub();
      })
      .finally(function () {
        btn.disabled = false;
        if (downloadLoading) downloadLoading.hidden = true;
      });
  }

  var jobiBtn = document.getElementById("download-jobi-btn");
  var jobidocsBtn = document.getElementById("download-jobidocs-btn");
  if (jobiBtn) {
    jobiBtn.addEventListener("click", function () { fetchReleaseAndDownload("jobi", jobiBtn); });
  }
  if (jobidocsBtn) {
    jobidocsBtn.addEventListener("click", function () { fetchReleaseAndDownload("jobidocs", jobidocsBtn); });
  }

  /* Přepínač macOS / Windows */
  var osMacBtn = document.getElementById("os-mac");
  var osWinBtn = document.getElementById("os-win");
  var formatNote = document.getElementById("download-format-note");
  var heroLabel = document.getElementById("hero-download-label");
  var smartScreenNote = document.getElementById("download-smartscreen");

  var OS_TEXT = {
    mac: { note: "macOS · DMG · Apple Silicon i Intel", hero: "Stáhnout pro macOS" },
    win: { note: "Windows · instalátor .exe · 64bit", hero: "Stáhnout pro Windows" }
  };

  function applyOS(os) {
    selectedOS = os;
    // Hláška platí vždy pro konkrétní systém, po přepnutí by lhala.
    skryjZpravu();
    if (osMacBtn) {
      osMacBtn.classList.toggle("is-active", os === "mac");
      osMacBtn.setAttribute("aria-pressed", os === "mac" ? "true" : "false");
    }
    if (osWinBtn) {
      osWinBtn.classList.toggle("is-active", os === "win");
      osWinBtn.setAttribute("aria-pressed", os === "win" ? "true" : "false");
    }
    if (formatNote) formatNote.textContent = OS_TEXT[os].note;
    if (heroLabel) heroLabel.textContent = OS_TEXT[os].hero;
    // Upozornění na SmartScreen dává smysl jen u Windows.
    if (smartScreenNote) smartScreenNote.hidden = os !== "win";
  }

  if (osMacBtn) osMacBtn.addEventListener("click", function () { applyOS("mac"); });
  if (osWinBtn) osWinBtn.addEventListener("click", function () { applyOS("win"); });
  applyOS(selectedOS);
})();


/* Ukázky obrazovek: přepínání záložek. Bez skriptu zůstane vidět první snímek
   a ostatní jsou `hidden`, takže stránka funguje i tak. */
(function () {
  var seznam = document.querySelector(".ukazky-tabs");
  if (!seznam) return;
  var taby = Array.prototype.slice.call(seznam.querySelectorAll('[role="tab"]'));
  function vyber(tab) {
    taby.forEach(function (t) {
      var aktivni = t === tab;
      t.setAttribute("aria-selected", aktivni ? "true" : "false");
      t.tabIndex = aktivni ? 0 : -1;
      var panel = document.getElementById(t.getAttribute("aria-controls"));
      if (panel) panel.hidden = !aktivni;
    });
    tab.focus();
  }
  taby.forEach(function (t, i) {
    t.addEventListener("click", function () { vyber(t); });
    t.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") vyber(taby[(i + 1) % taby.length]);
      if (e.key === "ArrowLeft") vyber(taby[(i - 1 + taby.length) % taby.length]);
    });
  });
})();
