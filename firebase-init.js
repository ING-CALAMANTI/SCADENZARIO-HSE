/* ============================================================
   FIREBASE — persistenza condivisa + login per tutti i moduli.
   Espone un adattatore "Store" con la stessa forma di localStorage:
   Store.load(chiave) / Store.save(chiave, oggetto) — entrambe Promise.

   CON IL LOGIN (passo 3):
   - i dati vivono in  workspaces/{WORKSPACE}/moduli/{chiave}: uno spazio di
     studio CONDIVISO da tutti gli utenti autenticati (i colleghi dello studio
     vedono le STESSE aziende). In futuro WORKSPACE può diventare per-utente
     per dare a ogni consulente solo i propri dati.
   - Store.load/save aspettano automaticamente che l'utente sia
     autenticato: la schermata di login (auth-gate.js) copre il modulo
     finché non si entra, poi il caricamento parte da solo.

   FALLBACK: se la config Firebase non è compilata (o l'SDK non è
   caricato), Store ricade su localStorage e NON c'è login (utile in
   sviluppo). In quel caso i dati restano solo su quel browser.

   Richiede, PRIMA di questo file, l'SDK Firebase (compat) via <script>:
     firebase-app-compat.js, firebase-firestore-compat.js, firebase-auth-compat.js
   e DOPO questo file: auth-gate.js (la schermata di login).

   JS classico (var/function) per coerenza con fondamenta.js.
   Versione 2.0 — 06/08/2026 (aggiunto login e dati per-utente)
   ============================================================ */
var Store = (function(){

  /* ----------------------------------------------------------------
     CONFIG FIREBASE — chiavi del progetto scadenzario-hse-13d73.
     Se i campi sono vuoti, si usa localStorage senza login.
     ---------------------------------------------------------------- */
  var firebaseConfig = {
    apiKey:            "AIzaSyBD-PP2rADrrQ5z_e-SsigP2L3Ljrz_YAM",
    authDomain:        "scadenzario-hse-13d73.firebaseapp.com",
    projectId:         "scadenzario-hse-13d73",
    storageBucket:     "scadenzario-hse-13d73.firebasestorage.app",
    messagingSenderId: "796538161068",
    appId:             "1:796538161068:web:0ad25f2c366c7932ce9c09"
  };

  /* ---------------------------------------------------------------- */
  var db = null;
  var useFirebase = false;
  var currentUser = null;
  var _waiters = [];   // richieste di load/save in attesa del login

  function configPresente(){
    return !!(firebaseConfig.projectId && firebaseConfig.apiKey);
  }

  function init(){
    if(!configPresente()){
      console.info("[Store] Firebase non configurato: uso localStorage (senza login).");
      return;
    }
    if(typeof firebase === "undefined" || !firebase.firestore){
      console.warn("[Store] SDK Firebase non caricato: uso localStorage. "
        + "Controlla i tag <script> di firebase-*-compat.js.");
      return;
    }
    try{
      if(!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      useFirebase = true;

      /* Ascolta lo stato di login: quando un utente entra, sblocca le
         load/save rimaste in attesa (i moduli che avevano chiamato
         carica() prima del login). */
      if(firebase.auth){
        firebase.auth().onAuthStateChanged(function(user){
          currentUser = user || null;
          if(user){
            var w = _waiters; _waiters = [];
            for(var i=0;i<w.length;i++) w[i](user.uid);
          }
          console.info("[Store] Auth: " + (user ? ("utente " + user.email) : "nessun utente"));
        });
      }
      console.info("[Store] Firebase attivo (progetto: " + firebaseConfig.projectId + ").");
    }catch(e){
      console.warn("[Store] init Firebase fallito, uso localStorage:", e);
      useFirebase = false;
    }
  }

  /* Risolve con l'uid dell'utente autenticato. Se nessuno è ancora
     loggato, resta in attesa fino al login (la load/save riprende poi). */
  function _awaitUid(){
    if(currentUser) return Promise.resolve(currentUser.uid);
    return new Promise(function(res){ _waiters.push(res); });
  }

  /* --- fallback localStorage (solo se Firebase non è attivo) --- */
  function _localLoad(key){
    try{
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ console.warn("[Store] localStorage load fallito:", e); return null; }
  }
  function _localSave(key, obj){
    try{ localStorage.setItem(key, JSON.stringify(obj)); }
    catch(e){ console.warn("[Store] localStorage save fallito:", e); }
  }

  /* --- Dove vivono i dati ---
     OGGI: uno spazio UNICO di studio, condiviso da tutti gli utenti
     autenticati → i colleghi dello studio vedono le stesse aziende.
     DOMANI (vendita del pacchetto): per dare a ogni consulente solo i suoi
     dati basterà rendere WORKSPACE dinamico (ricavato dal profilo utente)
     invece che costante; la struttura workspaces/{id}/moduli/{chiave} resta
     identica, quindi nessun dato da rifare. */
  var WORKSPACE = "studio-hse";
  function _doc(key){
    return db.collection("workspaces").doc(WORKSPACE).collection("moduli").doc(key);
  }

  /* --- API pubblica: sempre Promise --- */

  /* load(chiave) -> Promise<oggetto|null> */
  function load(key){
    if(!useFirebase) return Promise.resolve(_localLoad(key));
    return _awaitUid().then(function(){
      return _doc(key).get()
        .then(function(snap){
          return (snap.exists && snap.data()) ? snap.data().payload : null;
        });
    }).catch(function(e){
      console.warn("[Store] load Firebase fallito:", e);
      return null;
    });
  }

  /* save(chiave, oggetto) -> Promise<void> */
  function save(key, obj){
    if(!useFirebase){ _localSave(key, obj); return Promise.resolve(); }
    return _awaitUid().then(function(){
      return _doc(key).set({ payload: obj, aggiornato: Date.now() });
    }).catch(function(e){
      console.warn("[Store] save Firebase fallito:", e);
    });
  }

  /* Lista aziende dall'ANAGRAFICA CONDIVISA (Modulo Aziende), normalizzata a
     {id, nome, emailRef} per i moduli che mostrano un selettore azienda.
     Fonte unica: il documento "aziende_dati_v1" del Modulo Aziende. */
  function aziende(){
    return load("aziende_dati_v1").then(function(d){
      var arr = (d && d.aziende) || [];
      return arr.map(function(z){
        return {
          id: z.id,
          nome: (z.ragione || z.nome || "—") + (z.forma ? (" " + z.forma) : ""),
          emailRef: z.ddlEmail || "",
          ddl: z.ddl || ""
        };
      });
    }).catch(function(e){
      console.warn("[Store] lettura anagrafica aziende fallita:", e);
      return [];
    });
  }

  /* "firebase" | "local" */
  function mode(){ return useFirebase ? "firebase" : "local"; }

  /* --- Badge diagnostico: mostrato SOLO in modalità locale (sviluppo),
         per avvisare che i dati non stanno su Firebase. In modalità
         Firebase ci pensa la barra utente di auth-gate.js. --- */
  function _mostraBadge(){
    if(typeof document === "undefined" || mode() !== "local") return;
    var crea = function(){
      if(document.getElementById("store-stato")) return;
      var el = document.createElement("div");
      el.id = "store-stato";
      el.textContent = "● solo locale";
      el.title = "Dati salvati solo su questo browser (localStorage), senza login. Clicca per nascondere.";
      el.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9999;"
        + "font:600 11px -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        + "padding:5px 10px;border-radius:12px;cursor:pointer;opacity:.9;color:#fff;"
        + "background:#8a6d3b;box-shadow:0 1px 5px rgba(0,0,0,.25)";
      el.onclick = function(){ el.parentNode && el.parentNode.removeChild(el); };
      document.body.appendChild(el);
    };
    if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", crea);
    else crea();
  }

  init();
  _mostraBadge();

  return {
    load: load,
    save: save,
    aziende: aziende,
    mode: mode,
    configPresente: configPresente
  };
})();
