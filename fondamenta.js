/* ============================================================
   FONDAMENTA CONDIVISE — logica comune a tutti i moduli
   JS classico (var, function) per coerenza con lo stack esistente.
   Versione 1.0 — 30/07/2026
   ============================================================ */
var Fond = (function(){

  var MS_GIORNO = 86400000;

  /* --- Giorni mancanti a una data (negativo = già scaduta) --- */
  function giorniA(dataScad, daData){
    if(!dataScad) return null;
    var sc = (typeof dataScad === "string") ? new Date(dataScad) : dataScad;
    var base = daData ? (typeof daData==="string"?new Date(daData):daData) : new Date();
    base.setHours(0,0,0,0);
    return Math.ceil((sc - base) / MS_GIORNO);
  }

  /* --- Stato scadenza parametrico.
         preavviso = giorni entro cui è "in scadenza" (default 60).
         Ritorna: "scaduta" | "in_scadenza" | "ok" | "na" --- */
  function statoScad(dataScad, preavviso){
    if(!dataScad) return "na";
    var g = giorniA(dataScad);
    if(g === null) return "na";
    var soglia = (preavviso === undefined || preavviso === null) ? 60 : preavviso;
    if(g < 0) return "scaduta";
    if(g <= soglia) return "in_scadenza";
    return "ok";
  }

  /* --- HTML del badge di stato, con etichetta opzionale --- */
  var CLASSE = {scaduta:"b-scaduta", in_scadenza:"b-scadenza", ok:"b-ok", na:"b-neutro"};
  var ETICH  = {scaduta:"Scaduta", in_scadenza:"In scadenza", ok:"Ok", na:"—"};
  function badge(stato, etichetta){
    var cls = CLASSE[stato] || "b-neutro";
    var txt = (etichetta !== undefined) ? etichetta : (ETICH[stato] || stato);
    return '<span class="badge '+cls+'">'+txt+'</span>';
  }

  /* --- Data italiana --- */
  function fmtData(d){
    if(!d) return "—";
    if(typeof d === "string") d = new Date(d);
    if(isNaN(d)) return "—";
    return d.toLocaleDateString("it-IT");
  }

  /* --- Aggiunge N giorni a una data, ritorna Date --- */
  function addGiorni(data, giorni){
    if(!data || !giorni) return null;
    var d = (typeof data==="string") ? new Date(data) : new Date(data.getTime());
    d.setDate(d.getDate() + Number(giorni));
    return d;
  }

  /* --- Email a segnaposto GENERICA.
         tpl = testo con {CHIAVE}; mappa = { CHIAVE: valore, ... }.
         Ogni modulo passa i propri campi, senza cablarli qui. --- */
  function applicaSegnaposto(tpl, mappa){
    var out = String(tpl || "");
    for(var k in mappa){
      if(!mappa.hasOwnProperty(k)) continue;
      var re = new RegExp("\\{"+k+"\\}", "g");
      out = out.replace(re, (mappa[k] === undefined || mappa[k] === null) ? "" : mappa[k]);
    }
    return out;
  }

  /* --- Invio email: placeholder unico per tutti i moduli.
         Sostituire QUI con Brevo quando si collega l'invio reale. --- */
  function inviaEmail(){
    alert("Simulazione invio completata.\nL'invio reale sarà attivo con Brevo.");
  }

  /* ============================================================
     STORICO INVII — condiviso da tutti i moduli che mandano email.
     Generico: non conosce "adempimenti" o "fornitori". Ogni modulo
     passa il proprio record (un oggetto qualsiasi) e i dati dell'invio.
     Il record ospita l'array record.storicoInvii = [].
     ============================================================ */

  function oggiIT(){
    var d = new Date();
    return ("0"+d.getDate()).slice(-2)+"/"+("0"+(d.getMonth()+1)).slice(-2)+"/"+d.getFullYear();
  }
  function oraCorrenteIT(){
    var d = new Date();
    return oggiIT()+" "+("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2);
  }
  /* estrae il timestamp da una stringa "gg/mm/aaaa[ hh:mm]"; 0 se assente */
  function parseDataIT(s){
    if(!s) return 0;
    var m = (""+s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if(!m) return 0;
    return new Date(m[3], m[2]-1, m[1]).getTime();
  }

  /* Registra uno o più invii nel record.
     record  : oggetto del modulo (adempimento, fornitore, contratto...)
     invii   : array di { dest, email, oggetto, testo } — testo va CONGELATO dal chiamante
     opts    : { esito:"inviata"|"manuale"|..., manuale:bool, messageId, ricevutaPEC }
     Ritorna il numero di invii registrati. */
  function registraInvii(record, invii, opts){
    if(!record) return 0;
    if(!record.storicoInvii) record.storicoInvii = [];
    opts = opts || {};
    var ora = opts.manuale ? (opts.data || oggiIT()) : oraCorrenteIT();
    for(var i=0;i<invii.length;i++){
      var v = invii[i];
      record.storicoInvii.push({
        data: ora,
        dest: v.dest || "",
        email: v.email || "",
        oggetto: v.oggetto || "",
        testo: v.testo || "",               // congelato dal chiamante
        esito: opts.esito || "inviata",
        manuale: !!opts.manuale,
        messageId: opts.messageId || "",     // predisposti per backend/PEC reali
        ricevutaPEC: opts.ricevutaPEC || ""
      });
    }
    return invii.length;
  }

  /* HTML dello storico di UN record (per la finestra email del modulo). */
  function htmlStoricoRecord(record){
    var st = (record && record.storicoInvii) || [];
    if(!st.length) return '<div style="font-size:12px;color:#aaa;border-top:1px solid var(--bordo,#ddd);padding-top:10px">Nessun invio registrato.</div>';
    var h = '<div style="border-top:1px solid var(--bordo,#ddd);padding-top:10px"><p style="font-size:11px;font-weight:600;color:var(--testo-soft,#555);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Storico invii ('+st.length+')</p>';
    for(var i=st.length-1;i>=0;i--) h += _cardInvio(st[i], null, false);
    h += '</div>';
    return h;
  }

  /* Raccoglie tutti gli invii da una lista di record, annotati.
     records : array di { record, etichetta } dove etichetta = testo identificativo (es. nome adempimento)
     Ritorna array di { et, azi, e } ordinato per data desc. */
  function raccogliInvii(records, nomeAzienda){
    var items = [];
    for(var i=0;i<records.length;i++){
      var st = (records[i].record.storicoInvii) || [];
      for(var k=0;k<st.length;k++) items.push({ et: records[i].etichetta, azi: nomeAzienda||"", e: st[k] });
    }
    items.sort(function(x,y){ return parseDataIT(y.e.data) - parseDataIT(x.e.data); });
    return items;
  }

  /* Filtra per finestra temporale (mesi). mesi>=9999 = tutto.
     Ritorna { items, nascosti }. */
  function filtraPeriodo(items, mesi){
    if(!mesi || mesi>=9999) return { items: items, nascosti: 0 };
    var lim = new Date(); lim.setMonth(lim.getMonth()-mesi);
    var limMs = lim.getTime();
    var tot = items.length;
    var out = items.filter(function(it){ var t = parseDataIT(it.e.data); return t===0 || t>=limMs; });
    return { items: out, nascosti: tot - out.length };
  }

  /* Card HTML di un singolo invio (usata sia nel record sia nella vista globale).
     mostraEtichetta: se true, mostra et/azienda in testa. */
  function _cardInvio(e, etichetta, mostraEtichetta){
    var col = e.esito==="inviata" ? "var(--ok,#27ae60)" : (e.esito==="manuale" ? "#888" : "var(--rosso,#c0392b)");
    var h = '<div style="background:#fff;border:1px solid var(--bordo,#ddd);border-left:3px solid '+col+';border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:12px">';
    if(mostraEtichetta && etichetta) h += '<div style="font-weight:600;margin-bottom:2px">'+etichetta+'</div>';
    h += '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span style="font-weight:600">'+e.data+'</span><span style="color:'+col+';font-weight:600">'+e.esito+(e.manuale?" (manuale)":"")+'</span></div>';
    h += '<div style="color:var(--testo-soft,#666);margin-top:2px">A: '+e.dest+' &lt;'+e.email+'&gt;</div>';
    h += '<div style="color:#999;font-size:11px;margin-top:2px">Oggetto: '+e.oggetto+'</div>';
    h += '<details style="margin-top:4px"><summary style="cursor:pointer;font-size:11px;color:var(--verde,#0f5e5a)">Testo inviato</summary><div style="font-size:12px;color:#444;margin-top:4px;white-space:pre-wrap">'+e.testo+'</div></details>';
    if(e.messageId||e.ricevutaPEC) h += '<div style="color:#999;font-size:10px;margin-top:2px">Rif: '+(e.messageId||e.ricevutaPEC)+'</div>';
    h += '</div>';
    return h;
  }

  /* HTML della vista storico globale (lista già filtrata).
     items: da raccogliInvii (+ filtraPeriodo). mostraAzienda: badge azienda per vista consulente. */
  function htmlStoricoGlobale(items, nascosti, mesi, mostraAzienda){
    if(!items.length){
      var msg = nascosti>0
        ? ('Nessun invio nel periodo selezionato. '+nascosti+' invii più vecchi sono in archivio: scegli "Tutto lo storico" per vederli.')
        : 'Nessun invio registrato.';
      return '<p style="color:#888;font-size:13px;padding:1rem">'+msg+'</p>';
    }
    var h = '<div style="font-size:12px;color:#888;margin-bottom:8px">'+items.length+' invii'
      + (nascosti>0 ? (' &middot; <span style="color:#aaa">'+nascosti+' in archivio (oltre '+mesi+' mesi) non mostrati</span>') : '') + '</div>';
    for(var i=0;i<items.length;i++){
      var it = items[i];
      var et = it.et + (mostraAzienda && it.azi ? ' <span style="font-size:11px;color:#2563a8;font-weight:600">· '+it.azi+'</span>' : '');
      h += _cardInvio(it.e, et, true);
    }
    return h;
  }

  /* Export CSV di una lista di invii (sempre completa, ignora il filtro vista). */
  function esportaInviiCSV(items, nomeFile){
    var righe = [["Data","Azienda","Riferimento","Destinatario","Email","Oggetto","Esito","Riferimento invio","Testo"]];
    for(var i=0;i<items.length;i++){
      var it = items[i], e = it.e;
      righe.push([e.data, it.azi||"", it.et||"", e.dest, e.email, e.oggetto, e.esito, (e.messageId||e.ricevutaPEC||""), (e.testo||"").replace(/\n/g," ")]);
    }
    var csv = righe.map(function(r){ return r.map(function(c){ return '"'+(""+c).replace(/"/g,'""')+'"'; }).join(";"); }).join("\r\n");
    var blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = nomeFile || "storico_invii.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    giorniA: giorniA,
    statoScad: statoScad,
    badge: badge,
    fmtData: fmtData,
    addGiorni: addGiorni,
    applicaSegnaposto: applicaSegnaposto,
    inviaEmail: inviaEmail,
    /* --- storico invii condiviso --- */
    oggiIT: oggiIT,
    oraCorrenteIT: oraCorrenteIT,
    parseDataIT: parseDataIT,
    registraInvii: registraInvii,
    htmlStoricoRecord: htmlStoricoRecord,
    raccogliInvii: raccogliInvii,
    filtraPeriodo: filtraPeriodo,
    htmlStoricoGlobale: htmlStoricoGlobale,
    esportaInviiCSV: esportaInviiCSV
  };
})();