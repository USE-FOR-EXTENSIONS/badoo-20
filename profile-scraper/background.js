// Background service worker for profile-scraper
// Responsibilities:
// - persist collected profiles (no auto-download)
// - respond to export requests to download images into profile-named folders

function sanitizeName(s){
  if(!s) return 'unknown';
  try{ let t = String(s).normalize('NFKD').replace(/\p{Diacritic}/gu, ''); t = t.replace(/[<>:\\"\/\|\?\*]/g, '_'); t = t.replace(/\s+/g, '_'); if(t.length>64) t = t.slice(0,64); return t; }catch(e){ return 'profile'; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try{
    if(!msg) return;
    if(msg.type === 'profile_scraped' && msg.profile){
      // append/update profile in storage; do NOT schedule downloads
      chrome.storage.local.get({ profile_only_profiles: [] }, (res) => {
        const list = Array.isArray(res.profile_only_profiles) ? res.profile_only_profiles : [];
        const p = msg.profile;
        const key = p.id ? ('id:'+p.id) : ((p.name||'')+'||'+(p.age||''));
        const idx = list.findIndex(x => (x.id && x.id === p.id) || ((x.name===p.name) && (x.age===p.age)));
        if(idx >= 0){ list[idx] = Object.assign({}, list[idx], p, { ts: Date.now() }); }
        else { list.push(Object.assign({}, p, { ts: Date.now() })); }
        chrome.storage.local.set({ profile_only_profiles: list }, ()=> sendResponse({saved:true}));
      });
      return true; // keep channel open
    }

    // Export images: downloads images for stored profiles into folders
    if(msg.type === 'export_profile_images'){
      // msg.mode: 'all' or { index: number }
      chrome.storage.local.get({ profile_only_profiles: [] }, (res) => {
        const list = Array.isArray(res.profile_only_profiles) ? res.profile_only_profiles : [];
        const toExport = [];
        if(msg.mode === 'all'){
          for(const p of list) toExport.push(p);
        } else if(msg.mode && typeof msg.mode.index === 'number'){
          const p = list[msg.mode.index]; if(p) toExport.push(p);
        }
        let count = 0;
        for(const prof of toExport){
          const folder = prof.id ? ('id_' + sanitizeName(prof.id)) : sanitizeName(prof.name || ('profile_' + (++count)));
          const imgs = Array.isArray(prof.images) && prof.images.length ? prof.images : (prof.image ? [prof.image] : []);
          for(let i=0;i<imgs.length;i++){
            const url = imgs[i];
            try{
              let ext = 'jpg';
              try{ const parts = (url||'').split('?')[0].split('/'); const last = parts[parts.length-1] || ''; const maybe = last.split('.').pop(); if(maybe && maybe.length<=6) ext = maybe.replace(/[^a-zA-Z0-9]/g,'').toLowerCase() || 'jpg'; }catch(_){ }
              const namePart = sanitizeName(prof.name || prof.id || ('img'+(i+1)));
              const filename = `${folder}/${namePart}_${i+1}.${ext}`;
              chrome.downloads.download({ url: url, filename: filename, conflictAction: 'uniquify' }, (downloadId)=>{
                if(chrome.runtime.lastError) console.warn('download error', chrome.runtime.lastError.message);
                else console.debug('started', downloadId, filename);
              });
            }catch(e){ console.warn('export error', e); }
          }
        }
        sendResponse({started: true, count: toExport.length});
      });
      return true;
    }
  }catch(e){ console.warn('bg msg error', e); }
});
