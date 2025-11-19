// Content script for profile-scraper extension
// Behavior: when instructed, iterate nearby list, open each profile, collect that profile's images (by scrolling gallery), and send each profile to background for storage.

(function(){
  const FIRST = '#page-container > div > div > div:nth-child(3) > div.people-nearby__content > div:nth-child(1) > ul';
  let __ps_running = false;
  let __ps_stop = false;

  // Specific selectors provided by user
  const GALLERY_BUTTON_SELECTOR = '#app-root > div > div.modal-container > div > div > div > div > div > div > div > div > div > div.profile-card-full__content > div > div.profile-card__content-scroller > div > div > div:nth-child(1) > button > span > span > div';
  const FULLSCREEN_GALLERY_SELECTOR = '#fullscreen-gallery';

  async function waitForSelector(selector, timeout = 2000){
    const start = Date.now();
    while(Date.now() - start < timeout){
      try{ const el = document.querySelector(selector); if(el) return el; }catch(e){}
      await sleep(150);
    }
    return null;
  }

  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  function findNearbyUL(){ return document.querySelector(FIRST) || document.querySelector('ul.csms-user-list') || null; }

  async function moveAndClick(el){ if(!el) return false; try{ el.scrollIntoView({block:'center'}); await sleep(220); el.click(); await sleep(300); return true;}catch(e){return false;} }

  async function waitForProfileOpen(timeout=2000){
    const start = Date.now(); const selectors=['[data-qa="profile-page"]','.csms-profile-page','.profile-page'];
    while(Date.now()-start < timeout){ for(const s of selectors){ const el = document.querySelector(s); if(el) return el; } await sleep(120); }
    return null;
  }

  async function loadAllProfileGallery(root, {maxSteps=20, stepDelay=300} = {}){
    try{
      const selectors = ['.csms-profile-media','.profile-photos','.csms-gallery','.profile-card-full__gallery'];
      let container = null;
      for(const s of selectors){ try{ const el = root.querySelector(s); if(el){ container = el; break; } }catch(e){} }
      if(!container) container = root;
      const seen = new Set(); let noNew=0;
      for(let step=0; step<maxSteps; step++){
        Array.from(container.querySelectorAll('img')).forEach(i=>{ if(i && i.src) seen.add(i.src); });
        Array.from(container.querySelectorAll('*')).forEach(el=>{ try{ const cs = window.getComputedStyle && window.getComputedStyle(el); const bg = (el.style && el.style.backgroundImage) || (cs && cs.backgroundImage) || ''; if(bg && bg !== 'none'){ const m=/url\(["']?(.*?)["']?\)/.exec(bg); if(m && m[1]) seen.add(m[1]); } }catch(e){} });
        if(seen.size === 0) noNew++; else noNew = 0;
        if(noNew >= 3) break;
        // try to advance gallery
        let advanced = false;
        try{ const next = container.querySelector('button[aria-label*="next" i], .next, .gallery-next'); if(next){ next.click(); advanced=true; } }catch(e){}
        if(!advanced){ try{ container.scrollLeft = (container.scrollLeft || 0) + Math.max(container.clientWidth*0.7,200); advanced = true; }catch(e){} }
        await sleep(stepDelay);
      }
      return Array.from(seen);
    }catch(e){ return []; }
  }

  async function scrapeOpenProfile(){
    try{
      const root = document.querySelector('[data-qa="profile-page"]') || document.querySelector('.csms-profile-page') || document.body;
      const nameEl = root.querySelector('.csms-profile-info__name-inner') || root.querySelector('[data-qa="profile-info__name"]') || null;
      const ageEl = root.querySelector('[data-qa="profile-info__age"]') || null;
      const idBtn = root.querySelector('button[data-qa-user-id]') || document.querySelector('button[data-qa-user-id]');
      const id = idBtn ? (idBtn.getAttribute('data-qa-user-id')||'') : '';
      const name = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim() : '';
      const age = ageEl ? (ageEl.innerText || ageEl.textContent || '').trim().replace(/^,\s*/,'') : '';
      // try to open gallery: first click the specific gallery-open button (user-provided selector)
      try{
        const galleryBtn = await waitForSelector(GALLERY_BUTTON_SELECTOR, 1200);
        if(galleryBtn){
          try{ galleryBtn.click(); await sleep(300); }catch(e){}
        } else {
          // fallback: try clicking a main image or thumbnail
          const main = root.querySelector('img'); if(main){ try{ main.click(); await sleep(250); }catch(e){} }
        }
      }catch(e){}

      // wait for the fullscreen slider/gallery to appear and use it as the extraction root
      let galleryRoot = await waitForSelector(FULLSCREEN_GALLERY_SELECTOR, 2000);
      if(!galleryRoot){ galleryRoot = document.querySelector('.profile-card-full__gallery') || document.body; }
      const imgs = await loadAllProfileGallery(galleryRoot, {maxSteps:20, stepDelay:300});
      const uniq = Array.from(new Set(imgs)).map(u => u && u.startsWith('//') ? window.location.protocol + u : u).filter(Boolean);
      return { id, name, age, images: uniq.slice(0,500), ts: Date.now() };
    }catch(e){ return null; }
  }

  function closeProfile(){ try{ const close = document.querySelector('button[aria-label*="close" i], button.csms-close'); if(close){ close.click(); return true; } document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27})); return true; }catch(e){return false;} }

  async function clickAndCollect(cfg={}){
    if(__ps_running) return; __ps_running=true; __ps_stop=false;
    const list = findNearbyUL(); if(!list){ __ps_running=false; return; }
    const items = Array.from(list.querySelectorAll('li.csms-user-list__item, li'));
    for(let i=0;i<items.length;i++){
      if(__ps_stop) break;
      const it = items[i];
      const clickTarget = it.querySelector('img') || it.querySelector('button[data-qa-user-id]') || it.querySelector('button');
      if(!clickTarget) continue;
      await moveAndClick(clickTarget);
      const opened = await waitForProfileOpen(2000);
      if(opened){ await sleep(200); const data = await scrapeOpenProfile(); if(data){ chrome.runtime.sendMessage({type:'profile_scraped', profile: data}); } closeProfile(); }
      await sleep(cfg.perProfileDelay || 500);
    }
    __ps_running = false;
  }

  // message listeners
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try{
      if(!msg) return;
      if(msg.type === 'start_profile_scrape'){
        clickAndCollect(msg.cfg||{});
        sendResponse({started:true});
        return true;
      }
      if(msg.type === 'stop_profile_scrape'){
        __ps_stop = true; sendResponse({stopping:true}); return true;
      }
    }catch(e){}
  });

})();
