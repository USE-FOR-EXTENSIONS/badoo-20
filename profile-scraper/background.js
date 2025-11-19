// Background service worker for profile-scraper
// Responsibilities:
// - persist collected profiles (no auto-download)
// - respond to export requests to download images into profile-named folders

function sanitizeName(s){
  if(!s) return 'unknown';
  try{ let t = String(s).normalize('NFKD').replace(/\p{Diacritic}/gu, ''); t = t.replace(/[<>:\\"\/\|\?\*]/g, '_'); t = t.replace(/\s+/g, '_'); if(t.length>64) t = t.slice(0,64); return t; }catch(e){ return 'profile'; }
}

// Create a ZIP Blob from an array of {name, data: Uint8Array}
async function createZipBlobFromEntries(entries){
  // CRC32 table
  const crcTable = (()=>{ const table = new Uint32Array(256); for(let i=0;i<256;i++){ let c=i; for(let k=0;k<8;k++) c = ((c&1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1)); table[i]=c; } return table; })();
  const crc32 = (uint8) => { let crc = 0 ^ (-1); for(let i=0;i<uint8.length;i++) crc = (crc >>> 8) ^ crcTable[(crc ^ uint8[i]) & 0xFF]; return (crc ^ (-1)) >>> 0; };
  const textEncoder = new TextEncoder();
  const parts = [];
  let offset = 0;
  const centralDir = [];
  for(const e of entries){
    const nameBuf = textEncoder.encode(e.name);
    const data = e.data;
    const crc = crc32(data);
    const size = data.length;
    const localHeader = new Uint8Array(30 + nameBuf.length);
    const dv = new DataView(localHeader.buffer); let p=0;
    dv.setUint32(p, 0x04034b50, true); p+=4; dv.setUint16(p, 20, true); p+=2; dv.setUint16(p, 0, true); p+=2; dv.setUint16(p, 0, true); p+=2; dv.setUint16(p, 0, true); p+=2; dv.setUint16(p, 0, true); p+=2;
    dv.setUint32(p, crc, true); p+=4; dv.setUint32(p, size, true); p+=4; dv.setUint32(p, size, true); p+=4; dv.setUint16(p, nameBuf.length, true); p+=2; dv.setUint16(p, 0, true); p+=2;
    localHeader.set(nameBuf, 30);
    parts.push(localHeader);
    parts.push(data);
    const centralHeader = new Uint8Array(46 + nameBuf.length);
    const cdv = new DataView(centralHeader.buffer); p=0;
    cdv.setUint32(p, 0x02014b50, true); p+=4; cdv.setUint16(p, 0x14, true); p+=2; cdv.setUint16(p, 20, true); p+=2; cdv.setUint16(p, 0, true); p+=2; cdv.setUint16(p, 0, true); p+=2; cdv.setUint16(p, 0, true); p+=2; cdv.setUint16(p, 0, true); p+=2;
    cdv.setUint32(p, crc, true); p+=4; cdv.setUint32(p, size, true); p+=4; cdv.setUint32(p, size, true); p+=4; cdv.setUint16(p, nameBuf.length, true); p+=2; cdv.setUint16(p, 0, true); p+=2; cdv.setUint16(p, 0, true); p+=2; cdv.setUint16(p, 0, true); p+=2; cdv.setUint16(p, 0, true); p+=2; cdv.setUint32(p, 0, true); p+=4; cdv.setUint32(p, offset, true); p+=4;
    centralHeader.set(nameBuf, 46);
    centralDir.push(centralHeader);
    offset += localHeader.length + size;
  }
  const centralSize = centralDir.reduce((s,b)=>s + b.length, 0);
  const centralOffset = offset;
  const eocdr = new Uint8Array(22);
  const ev = new DataView(eocdr.buffer); let pp=0; ev.setUint32(pp, 0x06054b50, true); pp+=4; ev.setUint16(pp, 0, true); pp+=2; ev.setUint16(pp, 0, true); pp+=2; ev.setUint16(pp, entries.length, true); pp+=2; ev.setUint16(pp, entries.length, true); pp+=2; ev.setUint32(pp, centralSize, true); pp+=4; ev.setUint32(pp, centralOffset, true); pp+=4; ev.setUint16(pp, 0, true); pp+=2;
  const blobParts = [];
  for(const p of parts) blobParts.push(p instanceof Uint8Array ? p : new Uint8Array(p));
  for(const c of centralDir) blobParts.push(c instanceof Uint8Array ? c : new Uint8Array(c));
  blobParts.push(eocdr);
  return new Blob(blobParts, {type:'application/zip'});
}

async function fetchAsUint8(url){
  try{
    if(!url) return null;
    if(url.startsWith('//')) url = (typeof location !== 'undefined' ? location.protocol : 'https:') + url;
    const resp = await fetch(url, {mode:'cors'});
    if(!resp.ok) return null;
    const ab = await resp.arrayBuffer();
    return new Uint8Array(ab);
  }catch(e){ console.warn('fetchAsUint8 failed', url, e); return null; }
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
      chrome.storage.local.get({ profile_only_profiles: [] }, async (res) => {
        const list = Array.isArray(res.profile_only_profiles) ? res.profile_only_profiles : [];
        const toExport = [];
        if(msg.mode === 'all'){
          for(const p of list) toExport.push(p);
        } else if(msg.mode && typeof msg.mode.index === 'number'){
          const p = list[msg.mode.index]; if(p) toExport.push(p);
        }
        let started = 0;
        for(const prof of toExport){
          const folder = prof.id ? ('id_' + sanitizeName(prof.id)) : sanitizeName(prof.name || ('profile_' + Date.now()));
          const imgs = Array.isArray(prof.images) && prof.images.length ? prof.images : (prof.image ? [prof.image] : []);
          const entries = [];
          if(!imgs.length){
            entries.push({ name: folder + '/_no_images.txt', data: new TextEncoder().encode(`No images for ${prof.id||prof.name||folder}`) });
          } else {
            for(let i=0;i<imgs.length;i++){
              const url = imgs[i];
              try{
                const arr = await fetchAsUint8(url);
                if(arr){
                  let ext = 'jpg';
                  try{ const parts = (url||'').split('?')[0].split('/'); const last = parts[parts.length-1] || ''; const maybe = last.split('.').pop(); if(maybe && maybe.length<=6) ext = maybe.replace(/[^a-zA-Z0-9]/g,'').toLowerCase() || 'jpg'; }catch(_){ }
                  const namePart = sanitizeName(prof.name || prof.id || ('img'+(i+1)));
                  const filename = `${folder}/${namePart}_${i+1}.${ext}`;
                  entries.push({ name: filename, data: arr });
                } else {
                  entries.push({ name: `${folder}/failed_image_${i+1}.txt`, data: new TextEncoder().encode(`Failed to fetch: ${url}`) });
                }
              }catch(e){ entries.push({ name: `${folder}/failed_image_${i+1}.txt`, data: new TextEncoder().encode(String(e)) }); }
          }
          try{
            const zipBlob = await createZipBlobFromEntries(entries);
            const urlObj = URL.createObjectURL(zipBlob);
            const zipName = `${folder}.zip`;
            chrome.downloads.download({ url: urlObj, filename: zipName, conflictAction: 'uniquify' }, (did)=>{
              if(chrome.runtime.lastError) console.warn('zip download error', chrome.runtime.lastError.message);
              else console.debug('started zip', did, zipName);
              // revoke after some time
              setTimeout(()=>{ try{ URL.revokeObjectURL(urlObj); }catch(e){} }, 60_000);
            });
            started++;
          }catch(e){ console.warn('zip create/download failed', e); }
        }
        sendResponse({started: true, count: started});
      });
      return true;
    }
  }catch(e){ console.warn('bg msg error', e); }
});
