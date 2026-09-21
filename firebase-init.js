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

  /* ================================================================
     ACCESSO CLIENTI — ruoli e dati per-azienda (fondamenta)
     ----------------------------------------------------------------
     Due tipi di utente:
       • STUDIO  → vede e gestisce TUTTE le aziende, TUTTI i moduli.
                   Riconosciuto dall'email (lista qui sotto): nessun
                   profilo da creare, accesso pieno.
       • CLIENTE → vede SOLO la propria azienda, e per ogni modulo con
                   il "livello" deciso dallo studio (0 nascosto, 1 con-
                   sulta, 2 compila date, 3 inserimento pieno).
                   La sua assegnazione (azienda + livelli) sta in
                   workspaces/studio-hse/users/{uid}.

     I dati "per-azienda" vivono in
       workspaces/studio-hse/aziende/{aziId}/moduli/{chiave}
     così le regole di sicurezza Firebase possono isolare davvero un
     cliente sulla sola cartella della sua azienda. Lo spazio vecchio
     workspaces/studio-hse/moduli/{chiave} resta per l'anagrafica
     condivisa e come rete di sicurezza durante la migrazione.
     ================================================================ */

  /* Email con ruolo STUDIO (accesso pieno). Aggiungere qui i colleghi. */
  var STUDIO_EMAILS = [
    "ing.calamanti@gmail.com",
    "ing.gelangastefano@gmail.com",
    "auroraiozzoli@gmail.com"
  ];

  function _emailStudio(email){
    email = (email || "").toLowerCase();
    for(var i=0;i<STUDIO_EMAILS.length;i++){
      if(String(STUDIO_EMAILS[i]).toLowerCase() === email) return true;
    }
    return false;
  }

  /* Documento dati di UNA azienda per UN modulo. */
  function _docAzi(aziId, key){
    return db.collection("workspaces").doc(WORKSPACE)
             .collection("aziende").doc(String(aziId))
             .collection("moduli").doc(key);
  }

  /* profile() -> Promise<{role, aziId, aziNome, livelli, email, uid, pending}>
     - STUDIO: role "studio", accesso pieno (nessuna lettura extra).
     - CLIENTE: legge la sua assegnazione; al primo accesso crea un
       profilo "in attesa" (senza azienda) che lo studio abiliterà. */
  function profile(){
    if(!useFirebase){
      return Promise.resolve({role:"studio", aziId:null, aziNome:"", livelli:{}, email:"(locale)", uid:"local", pending:false});
    }
    return _awaitUid().then(function(uid){
      var email = (currentUser && currentUser.email) || "";
      if(_emailStudio(email)){
        return {role:"studio", aziId:null, aziNome:"", livelli:{}, email:email, uid:uid, pending:false};
      }
      var ref = db.collection("workspaces").doc(WORKSPACE).collection("users").doc(uid);
      return ref.get().then(function(snap){
        if(snap.exists){
          var d = snap.data() || {};
          return {role:"cliente", aziId:(d.aziId||null), aziNome:(d.aziNome||""),
                  livelli:(d.livelli||{}), email:email, uid:uid, pending:!d.aziId};
        }
        /* primo accesso di un non-studio: profilo in attesa di abilitazione */
        var nuovo = {role:"cliente", email:email, aziId:null, aziNome:"", livelli:{}, creato:Date.now()};
        return ref.set(nuovo).then(function(){
          return {role:"cliente", aziId:null, aziNome:"", livelli:{}, email:email, uid:uid, pending:true};
        }).catch(function(){
          return {role:"cliente", aziId:null, aziNome:"", livelli:{}, email:email, uid:uid, pending:true};
        });
      });
    }).catch(function(e){
      console.warn("[Store] lettura profilo fallita:", e);
      return {role:"cliente", aziId:null, aziNome:"", livelli:{}, email:"", uid:"", pending:true};
    });
  }

  /* ================================================================
     ANNULLA ("torna indietro") — cronologia delle modifiche
     ----------------------------------------------------------------
     Prima di ogni salvataggio memorizziamo lo stato PRECEDENTE del
     documento. "Annulla" riscrive quel valore. La cronologia sta in
     sessionStorage: sopravvive ai ricaricamenti della stessa scheda
     (l'annulla ricarica la pagina), così si possono annullare più
     modifiche di fila. È per-scheda del browser e non condivisa.
     ================================================================ */
  var _cache = {};                                  // percorso doc -> ultimo valore noto
  var UNDO_KEY = "scad_undo_" + WORKSPACE;
  var UNDO_MAX = 12;                                // profondità massima cronologia
  function _pathDi(scope, aziId, key){ return scope==="azienda" ? ("azi:"+aziId+":"+key) : ("mod:"+key); }
  function _cacheSet(scope, aziId, key, payload){ _cache[_pathDi(scope,aziId,key)] = payload; }
  function _stackGet(){ try{ var r=sessionStorage.getItem(UNDO_KEY); return r?JSON.parse(r):[]; }catch(e){ return []; } }
  function _stackSet(s){ try{ sessionStorage.setItem(UNDO_KEY, JSON.stringify(s)); }catch(e){ /* quota piena: si degrada senza errori */ } }
  function _pushUndo(scope, aziId, key, etichetta){
    var p = _pathDi(scope, aziId, key);
    if(!(p in _cache)) return;                      // nessun "prima" noto: niente punto di annullo
    var s = _stackGet();
    s.push({ scope:scope, aziId:aziId, key:key, payload:_cache[p], t:Date.now(), et:(etichetta||"") });
    while(s.length > UNDO_MAX) s.shift();
    _stackSet(s);
  }
  /* undo() -> Promise<boolean> : ripristina l'ultimo stato salvato. */
  function undo(){
    var s=_stackGet();
    if(!s.length) return Promise.resolve(false);
    var e=s.pop(); _stackSet(s);
    if(!useFirebase){ _localSave(e.scope==="azienda"?("azi_"+e.aziId+"_"+e.key):e.key, e.payload); return Promise.resolve(true); }
    return _awaitUid().then(function(){
      var ref = e.scope==="azienda" ? _docAzi(e.aziId, e.key) : _doc(e.key);
      return ref.set({ payload:e.payload, aggiornato:Date.now() }).then(function(){
        _cacheSet(e.scope, e.aziId, e.key, e.payload);
        return true;
      });
    }).catch(function(err){ console.warn("[Store] undo fallito:", err); return false; });
  }
  function canUndo(){ return _stackGet().length > 0; }
  function undoCount(){ return _stackGet().length; }

  /* loadAzienda(aziId, chiave) -> Promise<oggetto|null> */
  function loadAzienda(aziId, key){
    if(!useFirebase) return Promise.resolve(_localLoad("azi_"+aziId+"_"+key));
    return _awaitUid().then(function(){
      return _docAzi(aziId, key).get().then(function(snap){
        var payload = (snap.exists && snap.data()) ? snap.data().payload : null;
        _cacheSet("azienda", aziId, key, payload);   // semina la cronologia
        return payload;
      });
    }).catch(function(e){ console.warn("[Store] loadAzienda fallito:", e); return null; });
  }

  /* saveAzienda(aziId, chiave, oggetto) -> Promise<void> */
  function saveAzienda(aziId, key, obj){
    if(!useFirebase){ _localSave("azi_"+aziId+"_"+key, obj); return Promise.resolve(); }
    return _awaitUid().then(function(){
      _pushUndo("azienda", aziId, key);              // salva lo stato precedente per "Annulla"
      _cacheSet("azienda", aziId, key, obj);
      return _docAzi(aziId, key).set({ payload: obj, aggiornato: Date.now() });
    }).catch(function(e){ console.warn("[Store] saveAzienda fallito:", e); });
  }

  /* --- Amministrazione accessi (uso dello STUDIO) --- */

  /* Elenco degli utenti-cliente registrati (per il pannello accessi). */
  function listUsers(){
    if(!useFirebase) return Promise.resolve([]);
    return _awaitUid().then(function(){
      return db.collection("workspaces").doc(WORKSPACE).collection("users").get()
        .then(function(qs){
          var out=[]; qs.forEach(function(doc){ var d=doc.data()||{}; d.uid=doc.id; out.push(d); });
          return out;
        });
    }).catch(function(e){ console.warn("[Store] listUsers fallito:", e); return []; });
  }

  /* Assegna un cliente a un'azienda con i livelli per-modulo. */
  function setAssegnazione(uid, aziId, aziNome, livelli){
    if(!useFirebase) return Promise.resolve();
    return _awaitUid().then(function(){
      return db.collection("workspaces").doc(WORKSPACE).collection("users").doc(uid)
        .set({ role:"cliente", aziId:(aziId||null), aziNome:(aziNome||""),
               livelli:(livelli||{}), aggiornato:Date.now() }, { merge:true });
    }).catch(function(e){ console.warn("[Store] setAssegnazione fallito:", e); });
  }

  /* --- API pubblica: sempre Promise --- */

  /* load(chiave) -> Promise<oggetto|null> */
  function load(key){
    if(!useFirebase) return Promise.resolve(_localLoad(key));
    return _awaitUid().then(function(){
      return _doc(key).get()
        .then(function(snap){
          var payload = (snap.exists && snap.data()) ? snap.data().payload : null;
          _cacheSet("moduli", null, key, payload);   // semina la cronologia
          return payload;
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
      _pushUndo("moduli", null, key);                // salva lo stato precedente per "Annulla"
      _cacheSet("moduli", null, key, obj);
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
    configPresente: configPresente,
    /* --- accesso clienti (fondamenta) --- */
    profile: profile,
    loadAzienda: loadAzienda,
    saveAzienda: saveAzienda,
    listUsers: listUsers,
    setAssegnazione: setAssegnazione,
    /* --- annulla ("torna indietro") --- */
    undo: undo,
    canUndo: canUndo,
    undoCount: undoCount
  };
})();
