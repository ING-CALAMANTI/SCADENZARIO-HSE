/* ============================================================
   AUTH-GATE — schermata di login condivisa da tutti i moduli.
   Copre il modulo con una schermata di accesso finché l'utente non
   è autenticato (email + password). Quando entra: la schermata sparisce
   e compare una barra "utente · Esci" in alto a destra.

   Accoppiato a firebase-init.js (Store):
   - se Store è in modalità "local" (Firebase non configurato) NON fa
     nulla: in sviluppo si lavora senza login.
   - gli account NON si creano da qui: li crea l'amministratore nella
     console Firebase (Authentication → Users). Nessun pulsante "Registrati".

   Richiede, PRIMA di questo file: firebase-*-compat.js e firebase-init.js.
   Versione 1.0 — 06/08/2026
   ============================================================ */
(function(){

  /* --- Pulsante "← Home" su ogni pagina TRANNE la index (torna al launcher).
         In basso a sinistra, angolo opposto alla barra utente. Indipendente dal login. --- */
  (function(){
    var p = (location.pathname || "").toLowerCase();
    var isHome = /(^|\/)index\.html?$/.test(p) || p === "/" || /\/$/.test(p);
    if(isHome) return;
    var crea = function(){
      if(document.getElementById("nav-home")) return;
      var b = document.createElement("a");
      b.id = "nav-home"; b.href = "index.html"; b.textContent = "← Home"; b.title = "Torna alla home";
      b.style.cssText = "position:fixed;bottom:12px;left:12px;z-index:9997;text-decoration:none;"
        + "background:var(--verde,#0f5e5a);color:#fff;font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        + "padding:6px 12px;border-radius:16px;box-shadow:0 1px 5px rgba(0,0,0,.2)";
      document.body.appendChild(b);
    };
    if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", crea);
    else crea();
  })();

  /* In modalità locale (dev) o senza SDK auth: nessun login. */
  if(typeof Store === "undefined" || Store.mode() !== "firebase") return;
  if(typeof firebase === "undefined" || !firebase.auth){
    console.warn("[Auth] SDK Firebase Auth non caricato: aggiungi firebase-auth-compat.js.");
    return;
  }

  var overlay = null, userbar = null;

  function messaggioErrore(ex){
    var c = (ex && ex.code) || "";
    if(c.indexOf("wrong-password") >= 0 || c.indexOf("invalid-credential") >= 0) return "Email o password non corretti.";
    if(c.indexOf("user-not-found") >= 0)   return "Nessun utente con questa email.";
    if(c.indexOf("invalid-email") >= 0)    return "Email non valida.";
    if(c.indexOf("user-disabled") >= 0)    return "Account disabilitato.";
    if(c.indexOf("too-many-requests") >= 0)return "Troppi tentativi. Riprova tra qualche minuto.";
    if(c.indexOf("network") >= 0)          return "Problema di rete. Controlla la connessione.";
    return "Accesso non riuscito. " + ((ex && ex.message) || "");
  }

  function buildOverlay(){
    overlay = document.createElement("div");
    overlay.id = "auth-overlay";
    /* Mostrato di default: così il modulo dietro non "lampeggia" prima del login. */
    overlay.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;"
      + "align-items:center;justify-content:center;background:var(--verde-scuro,#0a4340);"
      + "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";
    overlay.innerHTML =
        '<div id="auth-loading" style="color:#fff;opacity:.9;font:600 15px -apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif">Scadenzario Sicurezza…</div>'
      + '<div id="auth-card" style="display:none;background:#fff;border-radius:14px;padding:30px 28px;width:330px;max-width:90vw;box-shadow:0 12px 44px rgba(0,0,0,.35)">'
      +   '<h2 style="margin:0 0 4px;font-size:19px;color:var(--verde,#0f5e5a)">Scadenzario Sicurezza</h2>'
      +   '<p style="margin:0 0 18px;font-size:13px;color:#666">Accedi per continuare</p>'
      +   '<label style="font-size:12px;font-weight:600;color:#555">Email</label>'
      +   '<input id="auth-email" type="email" autocomplete="username" '
      +     'style="width:100%;padding:10px;margin:4px 0 12px;border:1px solid #ccc;border-radius:8px;font-size:14px">'
      +   '<label style="font-size:12px;font-weight:600;color:#555">Password</label>'
      +   '<input id="auth-pass" type="password" autocomplete="current-password" '
      +     'style="width:100%;padding:10px;margin:4px 0 6px;border:1px solid #ccc;border-radius:8px;font-size:14px">'
      +   '<div id="auth-err" style="color:#c0392b;font-size:12px;min-height:16px;margin:6px 0"></div>'
      +   '<button id="auth-btn" style="width:100%;padding:11px;border:0;border-radius:8px;'
      +     'background:var(--verde,#0f5e5a);color:#fff;font-size:14px;font-weight:600;cursor:pointer">Entra</button>'
      + '</div>';
    document.body.appendChild(overlay);

    var email = overlay.querySelector("#auth-email");
    var pass  = overlay.querySelector("#auth-pass");
    var btn   = overlay.querySelector("#auth-btn");
    var err   = overlay.querySelector("#auth-err");

    function tryLogin(){
      err.textContent = "";
      var e = email.value.trim(), p = pass.value;
      if(!e || !p){ err.textContent = "Inserisci email e password."; return; }
      btn.disabled = true; btn.textContent = "Accesso…";
      firebase.auth().signInWithEmailAndPassword(e, p)
        .catch(function(ex){
          btn.disabled = false; btn.textContent = "Entra";
          err.textContent = messaggioErrore(ex);
          pass.value = ""; pass.focus();
        });
      /* in caso di successo ci pensa onAuthStateChanged a nascondere l'overlay */
    }
    btn.addEventListener("click", tryLogin);
    email.addEventListener("keydown", function(ev){ if(ev.key === "Enter") pass.focus(); });
    pass.addEventListener("keydown", function(ev){ if(ev.key === "Enter") tryLogin(); });
  }

  function mostraUserbar(user){
    if(!userbar){
      userbar = document.createElement("div");
      userbar.id = "auth-userbar";
      userbar.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:9998;display:flex;"
        + "align-items:center;gap:8px;background:rgba(255,255,255,.94);border:1px solid var(--bordo,#d8dedd);"
        + "border-radius:20px;padding:4px 6px 4px 12px;box-shadow:0 1px 5px rgba(0,0,0,.15);"
        + "font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";
      document.body.appendChild(userbar);
    }
    userbar.innerHTML =
        '<span style="color:var(--verde,#0f5e5a)" title="Dati su Firebase">👤 ' + (user.email || "utente") + '</span>'
      + '<button id="auth-logout" style="border:0;border-radius:14px;background:#eef0f0;color:#333;'
      +   'padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer">Esci</button>';
    userbar.querySelector("#auth-logout").addEventListener("click", function(){
      firebase.auth().signOut().then(function(){ location.reload(); });
    });
    userbar.style.display = "flex";
  }

  function start(){
    buildOverlay();
    firebase.auth().onAuthStateChanged(function(user){
      if(user){
        overlay.style.display = "none";
        mostraUserbar(user);
      }else{
        if(userbar) userbar.style.display = "none";
        var ld = overlay.querySelector("#auth-loading"); if(ld) ld.style.display = "none";
        var card = overlay.querySelector("#auth-card"); if(card) card.style.display = "";
        overlay.style.display = "flex";
        var e = overlay.querySelector("#auth-email");
        if(e) setTimeout(function(){ e.focus(); }, 60);
      }
    });
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
