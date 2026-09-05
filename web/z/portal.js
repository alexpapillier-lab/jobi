/**
 * Jobi – zákaznický portál (/z/?t=<token>).
 * Statická stránka bez přihlášení; data čte a akce posílá do edge funkce portal-ticket.
 * Konfigurace: window.PORTAL_CONFIG.supabaseUrl (v index.html).
 */
(function () {
  'use strict';

  const CONFIG = window.PORTAL_CONFIG || { supabaseUrl: '' };
  const BASE = (CONFIG.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/portal-ticket';
  const REFRESH_MS = 60 * 1000;
  const SIGNATURE_MAX_BYTES = 300 * 1024;

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const token = (params.get('t') || '').trim();

  const el = {
    topbar: $('topbar'), topbarName: $('topbarName'), topbarPhone: $('topbarPhone'),
    hdr: $('hdr'), svcName: $('svcName'), svcContacts: $('svcContacts'),
    viewLoading: $('viewLoading'), viewError: $('viewError'), viewContent: $('viewContent'),
    errorTitle: $('errorTitle'), errorText: $('errorText'), retryBtn: $('retryBtn'),
    offlineBanner: $('offlineBanner'),
    cardStatus: $('cardStatus'), cardQuote: $('cardQuote'), cardPrice: $('cardPrice'),
    cardPhotos: $('cardPhotos'), cardSign: $('cardSign'),
    ftrText: $('ftrText'),
    lightbox: $('lightbox'), lbImg: $('lbImg'), lbClose: $('lbClose'), lbPrev: $('lbPrev'), lbNext: $('lbNext'), lbCounter: $('lbCounter'),
    toast: $('toast'),
  };

  const state = {
    data: null,          // poslední payload { ticket, service, payment }
    busy: false,         // běží POST
    quoteMode: 'idle',   // idle | approve | reject
    quoteError: '',
    signError: '',
    fingerprints: {},    // per-card otisk dat – karta se překreslí jen při změně
    refreshTimer: null,
    lightbox: { photos: [], index: 0, lastFocus: null },
    sig: null,           // instance podpisového pole
  };

  /* ===================== Pomocné funkce ===================== */

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v; // jen pro vlastní statické SVG
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'disabled' || k === 'hidden') node[k] = !!v;
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null || c === false) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  const ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 7L2 7"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };
  function icon(name) { return h('span', { class: 'ico', html: ICON[name] || '' }); }

  const dateFmt = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const moneyFmt = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 0, maximumFractionDigits: 2 });

  function parseDate(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(v) { const d = parseDate(v); return d ? dateFmt.format(d) : ''; }
  function fmtDateTime(v) { const d = parseDate(v); return d ? dateTimeFmt.format(d) : ''; }
  function fmtMoney(v) {
    const n = Number(v);
    return isFinite(n) ? moneyFmt.format(n) : '';
  }
  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function str(v) { return v == null ? '' : String(v); }

  /* Kontrast textu pro barvu statusu (WCAG relativní luminance). */
  function parseColor(c) {
    if (typeof c !== 'string') return null;
    const s = c.trim();
    let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      let hex = m[1];
      if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
      const n = parseInt(hex, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }
  function luminance(rgb) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function pillColors(color) {
    const rgb = parseColor(color);
    if (!rgb) return { bg: '#e5e7eb', fg: '#1f2937' };
    const white = [255, 255, 255], dark = [17, 24, 39];
    const fg = contrast(rgb, white) >= contrast(rgb, dark) ? '#ffffff' : '#111827';
    return { bg: 'rgb(' + rgb.join(',') + ')', fg };
  }

  function telHref(phone) { return 'tel:' + str(phone).replace(/[^\d+]/g, ''); }
  function mapsHref(service) {
    const q = [service.addressStreet, service.addressZip, service.addressCity].map(str).filter(Boolean).join(', ');
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }
  function webHref(w) {
    const s = str(w).trim();
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : 'https://' + s;
  }

  const METHOD_LABELS = {
    personal: 'Osobně', in_person: 'Osobně', osobne: 'Osobně',
    courier: 'Kurýrem', kuryr: 'Kurýrem', post: 'Poštou', posta: 'Poštou',
    shipping: 'Zásilkou', delivery: 'Doručením', pickup: 'Vyzvednutí',
  };
  function methodLabel(v) {
    const s = str(v).trim();
    if (!s) return '';
    return METHOD_LABELS[s.toLowerCase()] || s;
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fallback níže */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ===================== API ===================== */

  function ApiError(status, message) {
    this.status = status;
    this.message = message;
  }

  function messageForStatus(status, data) {
    if (status === 404) return 'Odkaz není platný nebo vypršel.';
    if (status === 429) return 'Příliš mnoho požadavků. Zkuste to prosím za chvíli.';
    if (status === 409) return (data && data.error) || 'Tuto akci už není možné provést.';
    if (status >= 500) return 'Server je dočasně nedostupný. Zkuste to prosím později.';
    if (status === 0) return 'Nepodařilo se připojit. Zkontrolujte připojení k internetu.';
    return (data && (data.error || data.message)) || ('Chyba ' + status + '.');
  }

  async function request(method, body) {
    let res;
    try {
      res = await fetch(method === 'GET' ? BASE + '?t=' + encodeURIComponent(token) : BASE, {
        method,
        headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(Object.assign({ t: token }, body)),
        cache: 'no-store',
      });
    } catch (e) {
      throw new ApiError(0, messageForStatus(0));
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, messageForStatus(res.status, data));
    if (!data || data.ok === false || !data.ticket) {
      throw new ApiError(res.status, (data && data.error) || 'Neplatná odpověď serveru.');
    }
    return data;
  }

  /* ===================== Zobrazení stavů ===================== */

  function showView(name) {
    el.viewLoading.hidden = name !== 'loading';
    el.viewError.hidden = name !== 'error';
    el.viewContent.hidden = name !== 'content';
  }

  function showError(title, text, canRetry) {
    el.errorTitle.textContent = title;
    el.errorText.textContent = text;
    el.retryBtn.hidden = !canRetry;
    showView('error');
    if (!state.data) {
      clear(el.svcName);
      el.svcName.textContent = 'Servis';
      clear(el.svcContacts);
    }
  }

  /* ===================== Hlavička a patička ===================== */

  function renderHeader(service) {
    // Pobočka zakázky (když servis má víc míst) se ukáže za názvem servisu.
    const fullName = service.name ? (service.branch ? service.name + ' · ' + service.branch : service.name) : 'Servis';
    el.svcName.textContent = fullName;
    el.topbarName.textContent = fullName;
    document.title = (service.name ? service.name + ' – ' : '') + 'Stav zakázky';

    clear(el.svcContacts);
    if (service.openingHours) {
      el.svcContacts.appendChild(h('span', { class: 'contact' }, [icon('clock'), h('span', { text: service.openingHours })]));
    }
    if (service.phone) {
      el.svcContacts.appendChild(h('a', { class: 'contact', href: telHref(service.phone) }, [icon('phone'), h('span', { text: service.phone })]));
      el.topbarPhone.href = telHref(service.phone);
      el.topbarPhone.hidden = false;
    } else {
      el.topbarPhone.hidden = true;
    }
    if (service.email) {
      el.svcContacts.appendChild(h('a', { class: 'contact', href: 'mailto:' + service.email }, [icon('mail'), h('span', { text: service.email })]));
    }
    const addr = [service.addressStreet, [service.addressZip, service.addressCity].map(str).filter(Boolean).join(' ')].map(str).filter(Boolean).join(', ');
    if (addr) {
      el.svcContacts.appendChild(h('a', { class: 'contact', href: mapsHref(service), target: '_blank', rel: 'noopener' }, [icon('pin'), h('span', { text: addr })]));
    }
    const web = webHref(service.website);
    if (web) {
      el.svcContacts.appendChild(h('a', { class: 'contact', href: web, target: '_blank', rel: 'noopener' }, [icon('globe'), h('span', { text: str(service.website).replace(/^https?:\/\//i, '') })]));
    }
    el.ftrText.textContent = 'Stránku provozuje servis ' + (service.name || '') + '.';
  }

  /* ===================== Karta: stav ===================== */

  function renderStatus(ticket) {
    const card = el.cardStatus;
    clear(card);
    // Interní stav zakázky (Přijato, V opravě, …) zákazníkovi neukazujeme –
    // je to pracovní členění servisu. Zákazník vidí termín, nabídku a cenu.
    const status = ticket.status || {};

    card.appendChild(h('h2', { class: 'sr-only', id: 'statusTitle', text: 'Zakázka' }));
    card.appendChild(h('div', { class: 'status-head' }, [
      h('span', { class: 'code', text: ticket.code ? 'Zakázka ' + ticket.code : 'Zakázka' }),
    ]));

    const dl = h('dl', { class: 'dl' });
    const add = (label, value, pre) => {
      if (!value) return;
      dl.appendChild(h('dt', { text: label }));
      dl.appendChild(h('dd', { class: pre ? 'pre' : null, text: value }));
    };
    add('Přijato', fmtDate(ticket.createdAt));
    if (!status.isFinal) add('Předpokládané dokončení', fmtDateTime(ticket.expectedCompletionAt));
    add('Zařízení', str(ticket.deviceLabel));
    add('Požadovaná oprava', str(ticket.requestedRepair), true);
    add('Předání do servisu', methodLabel(ticket.handoffMethod));
    add('Vrácení zákazníkovi', methodLabel(ticket.handbackMethod));
    const hasPrice = (Array.isArray(ticket.performedRepairs) && ticket.performedRepairs.length) || num(ticket.totalPrice) > 0;
    if (!hasPrice && num(ticket.estimatedPrice) > 0) add('Odhad ceny', fmtMoney(ticket.estimatedPrice));
    card.appendChild(dl);

  }

  /* ===================== Karta: cenová nabídka ===================== */

  function renderQuote(ticket) {
    const card = el.cardQuote;
    const quote = ticket.quote || {};
    if (!quote.status || quote.status === 'none') { card.hidden = true; clear(card); return; }
    clear(card);
    card.hidden = false;

    card.appendChild(h('h2', { class: 'card-title', id: 'quoteTitle', text: 'Cenová nabídka' }));
    // Rozpis, když ho servis poslal. Starší nabídky mají jen částku.
    var items = Array.isArray(quote.items) ? quote.items : [];
    if (items.length) {
      var ul = h('ul', { class: 'price-list' });
      items.forEach(function (i) {
        ul.appendChild(h('li', {}, [h('span', { text: str(i && i.name) || 'Položka' }), h('span', { text: fmtMoney(i && i.price) })]));
      });
      card.appendChild(ul);
    }
    card.appendChild(h('div', { class: 'quote-amount', text: fmtMoney(quote.amount) }));
    if (quote.sentAt) card.appendChild(h('p', { class: 'card-note', text: 'Odesláno ' + fmtDateTime(quote.sentAt) }));
    if (quote.note) card.appendChild(h('p', { class: 'quote-note', text: str(quote.note) }));

    if (quote.status === 'approved') {
      card.appendChild(h('div', { class: 'result result-ok' }, [
        icon('check'),
        h('div', {}, ['Schváleno ' + fmtDateTime(quote.decidedAt)]),
      ]));
      return;
    }
    if (quote.status === 'rejected') {
      card.appendChild(h('div', { class: 'result result-no' }, [
        icon('cross'),
        h('div', {}, ['Zamítnuto ' + fmtDate(quote.decidedAt), h('small', { text: 'Ozveme se vám.' })]),
      ]));
      return;
    }
    if (quote.status !== 'sent') return;

    card.appendChild(h('p', { class: 'card-sub', text: 'Prosíme o vyjádření k cenové nabídce. Bez schválení opravu nezahájíme.' }));

    if (state.quoteMode === 'approve') {
      card.appendChild(h('div', { class: 'confirm', role: 'group', 'aria-label': 'Potvrzení schválení' }, [
        h('p', { text: 'Schválením souhlasíte s opravou za ' + fmtMoney(quote.amount) + '.' }),
        h('div', { class: 'btn-row' }, [
          h('button', { type: 'button', class: 'btn btn-primary', disabled: state.busy, text: state.busy ? 'Odesílám…' : 'Potvrdit', onclick: () => doAction('approve') }),
          h('button', { type: 'button', class: 'btn btn-secondary', disabled: state.busy, text: 'Zpět', onclick: () => setQuoteMode('idle') }),
        ]),
      ]));
    } else if (state.quoteMode === 'reject') {
      const ta = h('textarea', { class: 'input', id: 'rejectNote', maxlength: '500', placeholder: 'Např. „Oprava je pro mě příliš drahá, zařízení si vyzvednu.“' });
      card.appendChild(h('div', { class: 'confirm', role: 'group', 'aria-label': 'Zamítnutí nabídky' }, [
        h('p', { text: 'Nabídku zamítnete a servis se vám ozve s dalším postupem.' }),
        h('label', { class: 'lbl', for: 'rejectNote', text: 'Poznámka pro servis (nepovinné)' }),
        ta,
        h('div', { class: 'btn-row' }, [
          h('button', { type: 'button', class: 'btn btn-danger', disabled: state.busy, text: state.busy ? 'Odesílám…' : 'Potvrdit zamítnutí', onclick: () => doAction('reject', { note: ta.value.trim() }) }),
          h('button', { type: 'button', class: 'btn btn-secondary', disabled: state.busy, text: 'Zpět', onclick: () => setQuoteMode('idle') }),
        ]),
      ]));
    } else {
      card.appendChild(h('div', { class: 'btn-row' }, [
        h('button', { type: 'button', class: 'btn btn-primary', disabled: state.busy, text: 'Schválit opravu', onclick: () => setQuoteMode('approve') }),
        h('button', { type: 'button', class: 'btn btn-secondary', disabled: state.busy, text: 'Nesouhlasím', onclick: () => setQuoteMode('reject') }),
      ]));
    }
    if (state.quoteError) card.appendChild(h('div', { class: 'inline-error', role: 'alert', text: state.quoteError }));
  }

  function setQuoteMode(mode) {
    state.quoteMode = mode;
    state.quoteError = '';
    if (state.data) renderQuote(state.data.ticket);
    if (mode === 'reject') {
      const ta = $('rejectNote');
      if (ta) ta.focus();
    } else if (mode === 'approve') {
      const b = el.cardQuote.querySelector('.btn-primary');
      if (b) b.focus();
    }
  }

  /* ===================== Karta: cena a platba ===================== */

  function renderPrice(ticket, payment, service) {
    const card = el.cardPrice;
    const repairs = Array.isArray(ticket.performedRepairs) ? ticket.performedRepairs : [];
    const total = num(ticket.totalPrice);
    if (!repairs.length && total <= 0) { card.hidden = true; clear(card); return; }
    clear(card);
    card.hidden = false;

    card.appendChild(h('h2', { class: 'card-title', id: 'priceTitle', text: 'Cena opravy' }));
    if (repairs.length) {
      const ul = h('ul', { class: 'price-list' });
      repairs.forEach((r) => {
        ul.appendChild(h('li', {}, [h('span', { text: str(r && r.name) || 'Položka' }), h('span', { text: fmtMoney(r && r.price) })]));
      });
      const discount = num(ticket.discount);
      if (discount > 0) {
        ul.appendChild(h('li', { class: 'discount' }, [h('span', { text: 'Sleva' }), h('span', { text: '−' + fmtMoney(discount) })]));
      }
      card.appendChild(ul);
    }
    card.appendChild(h('div', { class: 'price-total' }, [h('span', { text: 'Celkem' }), h('span', { text: fmtMoney(total) })]));

    if (payment && payment.spayd) {
      const pay = h('div', { class: 'pay' });
      pay.appendChild(h('h3', { text: 'Platba předem / QR platba' }));
      pay.appendChild(h('p', { class: 'card-note', text: 'Můžete zaplatit předem QR kódem, nebo při vyzvednutí.' }));
      const qrWrap = h('div', { class: 'qr-wrap' });
      pay.appendChild(qrWrap);
      renderQr(qrWrap, payment.spayd);

      const rows = h('div');
      const addCopy = (label, value, copyValue) => {
        if (!value) return;
        const btn = h('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Kopírovat', 'aria-label': 'Kopírovat: ' + label });
        btn.addEventListener('click', async () => {
          const ok = await copyText(String(copyValue != null ? copyValue : value));
          toast(ok ? 'Zkopírováno' : 'Kopírování se nezdařilo');
        });
        rows.appendChild(h('div', { class: 'copy-row' }, [
          h('div', {}, [h('div', { class: 'k', text: label }), h('div', { class: 'v', text: String(value) })]),
          btn,
        ]));
      };
      addCopy('Částka', fmtMoney(payment.amount), num(payment.amount));
      addCopy('Číslo účtu', service.bankAccount);
      addCopy('IBAN', service.iban);
      addCopy('Variabilní symbol', payment.vs);
      pay.appendChild(rows);
      card.appendChild(pay);
    }
  }

  function renderQr(wrap, spayd) {
    clear(wrap);
    if (typeof window.QRCode !== 'function') {
      wrap.appendChild(h('p', { class: 'qr-fallback', text: 'QR kód se nepodařilo načíst. Použijte prosím údaje níže.' }));
      return;
    }
    try {
      const box = h('div', { role: 'img', 'aria-label': 'QR kód pro platbu' });
      wrap.appendChild(box);
      new window.QRCode(box, { text: spayd, width: 200, height: 200, correctLevel: window.QRCode.CorrectLevel.M });
      const img = box.querySelector('img');
      if (img) img.alt = 'QR kód pro platbu';
    } catch (e) {
      clear(wrap);
      wrap.appendChild(h('p', { class: 'qr-fallback', text: 'QR kód se nepodařilo vytvořit. Použijte prosím údaje níže.' }));
    }
  }

  /* ===================== Karta: fotky ===================== */

  function renderPhotos(ticket) {
    const card = el.cardPhotos;
    const before = Array.isArray(ticket.photosBefore) ? ticket.photosBefore.filter(Boolean) : [];
    const after = Array.isArray(ticket.photos) ? ticket.photos.filter(Boolean) : [];
    if (!before.length && !after.length) { card.hidden = true; clear(card); return; }
    clear(card);
    card.hidden = false;
    card.appendChild(h('h2', { class: 'card-title', id: 'photosTitle', text: 'Fotografie' }));

    const groups = [['Fotky z příjmu', before], ['Fotky z diagnostiky', after]];
    groups.forEach(([title, list]) => {
      if (!list.length) return;
      const grid = h('div', { class: 'photo-grid' });
      list.forEach((url, i) => {
        const btn = h('button', { type: 'button', class: 'photo-thumb', 'aria-label': title + ' – fotka ' + (i + 1) + ' z ' + list.length });
        btn.appendChild(h('img', { src: url, alt: title + ' ' + (i + 1), loading: 'lazy', decoding: 'async' }));
        btn.addEventListener('click', () => openLightbox(list, i, btn));
        grid.appendChild(btn);
      });
      card.appendChild(h('div', { class: 'photo-group' }, [h('h3', { text: title }), grid]));
    });
  }

  function openLightbox(photos, index, opener) {
    state.lightbox.photos = photos;
    state.lightbox.index = index;
    state.lightbox.lastFocus = opener || document.activeElement;
    el.lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    updateLightbox();
    el.lbClose.focus();
  }
  function updateLightbox() {
    const { photos, index } = state.lightbox;
    el.lbImg.src = photos[index];
    el.lbImg.alt = 'Fotka ' + (index + 1) + ' z ' + photos.length;
    el.lbCounter.textContent = (index + 1) + ' / ' + photos.length;
    el.lbPrev.hidden = photos.length < 2;
    el.lbNext.hidden = photos.length < 2;
  }
  function stepLightbox(delta) {
    const n = state.lightbox.photos.length;
    if (n < 2) return;
    state.lightbox.index = (state.lightbox.index + delta + n) % n;
    updateLightbox();
  }
  function closeLightbox() {
    el.lightbox.hidden = true;
    el.lbImg.removeAttribute('src');
    document.body.style.overflow = '';
    const f = state.lightbox.lastFocus;
    if (f && typeof f.focus === 'function' && document.contains(f)) f.focus();
  }
  el.lbClose.addEventListener('click', closeLightbox);
  el.lbPrev.addEventListener('click', () => stepLightbox(-1));
  el.lbNext.addEventListener('click', () => stepLightbox(1));
  el.lightbox.addEventListener('click', (e) => { if (e.target === el.lightbox || e.target.classList.contains('lb-stage')) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (el.lightbox.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); return; }
    if (e.key === 'Tab') {
      // Past fokusu uvnitř dialogu
      const focusables = [el.lbClose, el.lbPrev, el.lbNext].filter((b) => !b.hidden);
      const i = focusables.indexOf(document.activeElement);
      let next;
      if (e.shiftKey) next = i <= 0 ? focusables[focusables.length - 1] : focusables[i - 1];
      else next = i === -1 || i >= focusables.length - 1 ? focusables[0] : focusables[i + 1];
      e.preventDefault();
      next.focus();
    }
  });
  // Swipe mezi fotkami
  (function () {
    let startX = null;
    el.lightbox.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    el.lightbox.addEventListener('touchend', (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();

  /* ===================== Karta: podpis ===================== */

  function createSignaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    const strokes = []; // pole tahů; tah = pole bodů {x,y} v CSS px
    let current = null;
    let cssW = 0, cssH = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      cssW = rect.width; cssH = rect.height;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }
    function styleCtx(c) {
      c.lineWidth = 2.2;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = '#111827';
    }
    function drawStroke(c, pts) {
      if (!pts.length) return;
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) c.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
      c.stroke();
    }
    function redraw() {
      ctx.clearRect(0, 0, cssW, cssH);
      styleCtx(ctx);
      strokes.forEach((s) => drawStroke(ctx, s));
    }
    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      current = [pos(e)];
      strokes.push(current);
      canvas.classList.add('active');
      styleCtx(ctx);
      drawStroke(ctx, current);
      if (typeof pad.onchange === 'function') pad.onchange();
    }
    function onMove(e) {
      if (!current) return;
      e.preventDefault();
      const p = pos(e);
      const last = current[current.length - 1];
      current.push(p);
      styleCtx(ctx);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    function onUp(e) {
      if (!current) return;
      e.preventDefault();
      current = null;
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onUp);
    window.addEventListener('resize', resize);

    const pad = {
      onchange: null,
      hasInk: () => strokes.length > 0,
      clear() { strokes.length = 0; current = null; canvas.classList.remove('active'); redraw(); if (typeof pad.onchange === 'function') pad.onchange(); },
      destroy() { window.removeEventListener('resize', resize); },
      /** PNG data URL, šířka ≤ maxW px, bílé pozadí. */
      toDataUrl(maxW) {
        // Ořez na obsah s okrajem
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        strokes.forEach((s) => s.forEach((p) => {
          if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
        }));
        if (!isFinite(minX)) return '';
        const margin = 12;
        minX = Math.max(0, minX - margin); minY = Math.max(0, minY - margin);
        maxX = Math.min(cssW, maxX + margin); maxY = Math.min(cssH, maxY + margin);
        const w = Math.max(1, maxX - minX), hgt = Math.max(1, maxY - minY);
        const scale = Math.min(2, maxW / w); // až 2× pro ostrost, výsledná šířka ≤ maxW
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(w * scale));
        out.height = Math.max(1, Math.round(hgt * scale));
        const c = out.getContext('2d');
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, out.width, out.height);
        c.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
        styleCtx(c);
        strokes.forEach((s) => drawStroke(c, s));
        return out.toDataURL('image/png');
      },
    };
    requestAnimationFrame(resize);
    return pad;
  }

  function renderSign(ticket) {
    const card = el.cardSign;
    if (state.sig) { state.sig.destroy(); state.sig = null; }
    clear(card);
    card.hidden = false;
    card.appendChild(h('h2', { class: 'card-title', id: 'signTitle', text: 'Převzetí do opravy' }));

    if (ticket.intakeSignedAt) {
      const done = h('div', { class: 'sig-done' });
      done.appendChild(h('div', { class: 'result result-ok' }, [icon('check'), h('div', {}, ['Podepsáno ' + fmtDateTime(ticket.intakeSignedAt)])]));
      if (ticket.intakeSignatureUrl) {
        done.appendChild(h('img', { class: 'sig-img', src: ticket.intakeSignatureUrl, alt: 'Váš podpis', loading: 'lazy' }));
      }
      card.appendChild(done);
      return;
    }

    card.appendChild(h('p', { class: 'card-sub', text: 'Podpisem potvrzujete převzetí zařízení do opravy dle příjmového protokolu.' }));
    const canvas = h('canvas', { class: 'sig-pad', 'aria-label': 'Pole pro podpis – podepište se prstem nebo myší', role: 'img' });
    card.appendChild(h('div', { class: 'sig-pad-wrap' }, [canvas, h('p', { class: 'sig-hint', text: 'Podepište se prstem do rámečku.' })]));

    const clearBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Vymazat', disabled: true });
    const submitBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Podepsat', disabled: true });
    card.appendChild(h('div', { class: 'btn-row' }, [submitBtn, clearBtn]));
    if (state.signError) card.appendChild(h('div', { class: 'inline-error', role: 'alert', text: state.signError }));

    const pad = createSignaturePad(canvas);
    state.sig = pad;
    pad.onchange = () => {
      const ink = pad.hasInk();
      clearBtn.disabled = !ink || state.busy;
      submitBtn.disabled = !ink || state.busy;
    };
    clearBtn.addEventListener('click', () => pad.clear());
    submitBtn.addEventListener('click', async () => {
      if (!pad.hasInk() || state.busy) return;
      let dataUrl = '';
      let width = 600;
      // Zmenšuj, dokud PNG nevejde do limitu
      while (width >= 200) {
        dataUrl = pad.toDataUrl(width);
        if (dataUrl.length * 0.75 <= SIGNATURE_MAX_BYTES) break;
        width -= 100;
      }
      if (!dataUrl) return;
      submitBtn.textContent = 'Odesílám…';
      submitBtn.disabled = true;
      clearBtn.disabled = true;
      canvas.style.pointerEvents = 'none';
      await doAction('sign', { signature: dataUrl });
    });
  }

  /* ===================== Akce (POST) ===================== */

  async function doAction(action, extra) {
    if (state.busy) return;
    state.busy = true;
    if (action === 'approve' || action === 'reject') { state.quoteError = ''; renderQuote(state.data.ticket); }
    try {
      const data = await request('POST', Object.assign({ action }, extra || {}));
      state.busy = false;
      state.quoteMode = 'idle';
      state.quoteError = '';
      state.signError = '';
      applyData(data, true);
      if (action === 'approve') toast('Nabídka schválena');
      else if (action === 'reject') toast('Nabídka zamítnuta');
      else if (action === 'sign') toast('Podpis uložen');
    } catch (e) {
      state.busy = false;
      const msg = e && e.message ? e.message : 'Akce se nezdařila.';
      if (action === 'sign') {
        state.signError = msg;
        if (e && e.status === 409) {
          state.signError = 'Zakázka už byla podepsána.';
          refresh(true);
        } else {
          renderSign(state.data.ticket);
        }
      } else {
        state.quoteError = msg;
        if (e && e.status === 409) state.quoteMode = 'idle';
        renderQuote(state.data.ticket);
        if (e && e.status === 409) refresh(true);
      }
    }
  }

  /* ===================== Načtení a překreslení ===================== */

  function fp(obj) { try { return JSON.stringify(obj); } catch (e) { return String(Math.random()); } }

  /** Překreslí karty; při tichém obnovení jen ty, jejichž data se změnila. */
  function applyData(data, force) {
    const first = !state.data;
    state.data = data;
    const ticket = data.ticket || {};
    const service = data.service || {};
    const payment = data.payment || null;

    const fps = {
      header: fp(service),
      status: fp([ticket.code, ticket.createdAt, ticket.expectedCompletionAt, ticket.deviceLabel, ticket.requestedRepair, ticket.status, ticket.handoffMethod, ticket.handbackMethod, ticket.estimatedPrice, ticket.totalPrice, ticket.performedRepairs]),
      quote: fp(ticket.quote),
      price: fp([ticket.performedRepairs, ticket.discount, ticket.totalPrice, payment, service.bankAccount, service.iban]),
      photos: fp([ticket.photosBefore, ticket.photos]),
      sign: fp([ticket.intakeSignedAt, ticket.intakeSignatureUrl]),
    };
    const changed = (k) => first || force || state.fingerprints[k] !== fps[k];

    if (changed('header')) renderHeader(service);
    if (changed('status')) renderStatus(ticket);
    // Nabídku nepřekreslujeme, když v ní zákazník právě něco potvrzuje – jen když se změnila data
    if (changed('quote')) {
      if (state.fingerprints.quote !== fps.quote) state.quoteMode = 'idle';
      renderQuote(ticket);
    }
    if (changed('price')) renderPrice(ticket, payment, service);
    if (changed('photos')) renderPhotos(ticket);
    // Podpis: rozkreslený podpis zachovat, překreslit jen při změně dat nebo když je pole prázdné
    const drawing = state.sig && state.sig.hasInk() && !ticket.intakeSignedAt;
    if (first || state.fingerprints.sign !== fps.sign || (force && !drawing)) renderSign(ticket);

    state.fingerprints = fps;
    el.offlineBanner.hidden = true;
    showView('content');
  }

  async function load() {
    if (!token) {
      showError('Odkaz není platný', 'V odkazu chybí kód zakázky. Použijte prosím odkaz ze zprávy od servisu.', false);
      return;
    }
    if (!CONFIG.supabaseUrl) {
      showError('Stránka není nastavená', 'Kontaktujte prosím servis.', false);
      return;
    }
    showView('loading');
    try {
      const data = await request('GET');
      applyData(data, true);
    } catch (e) {
      const status = e && e.status;
      if (status === 404) showError('Odkaz není platný', 'Odkaz není platný nebo vypršel. Pokud potřebujete informace o zakázce, zavolejte prosím do servisu.', false);
      else if (status === 429) showError('Zkuste to za chvíli', e.message, true);
      else if (status === 0) showError('Jste offline', e.message, true);
      else showError('Něco se nepovedlo', e.message, true);
    }
  }

  /** Tiché obnovení dat na pozadí. */
  async function refresh(force) {
    if (!state.data || state.busy || !token) return;
    if (document.visibilityState !== 'visible' && !force) return;
    try {
      const data = await request('GET');
      if (state.busy) return;
      applyData(data, !!force);
    } catch (e) {
      if (e && e.status === 404) {
        showError('Odkaz není platný', 'Odkaz už není platný nebo vypršel. Pokud potřebujete informace o zakázce, zavolejte prosím do servisu.', false);
        return;
      }
      el.offlineBanner.hidden = false;
    }
  }

  function startTimer() {
    stopTimer();
    state.refreshTimer = setInterval(() => refresh(false), REFRESH_MS);
  }
  function stopTimer() {
    if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { refresh(false); startTimer(); }
    else stopTimer();
  });
  window.addEventListener('online', () => refresh(false));

  el.retryBtn.addEventListener('click', () => load());

  /* Kompaktní lišta po odscrollování hlavičky */
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      const visible = entries[0].isIntersecting;
      const show = !visible && !el.viewContent.hidden;
      el.topbar.classList.toggle('show', show);
      el.topbar.setAttribute('aria-hidden', show ? 'false' : 'true');
    }, { threshold: 0 });
    io.observe(el.hdr);
  }

  load();
  startTimer();
})();
