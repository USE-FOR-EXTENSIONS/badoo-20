// Console snippet: copy & paste into the page DevTools Console and run `runAll()`.
// It uses three selectors provided by the user to open profiles, open the gallery,
// extract image URLs, and download them.

(function(){
  const FIRST = "#page-container > div > div > div:nth-child(3) > div.people-nearby__content > div:nth-child(1) > ul > li:nth-child(1) > div > button > span.csms-user-list-cell__content > span.csms-user-list-cell__media > span > span > span > span > span";
  const SECOND = "#app-root > div > div.modal-container > div > div > div > div > div > div > div > div > div.profile-card-full__content > div > div.profile-card__content-scroller > div > div > div:nth-child(1) > button";
  const THIRD = "#fullscreen-gallery > div.slider-gallery > div.slider-gallery-pages.is-horizontal.is-animated > div:nth-child(2)";
  // New scrollbar selector (profile content scroller) provided by user — used to scroll
  const SCROLLBAR = "#app-root > div > div.modal-container > div > div > div > div > div > div > div > div > div > div.profile-card-full__content > div > div.profile-card__scroll-bar.profile-card__scroll-bar--centered";

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  // Console snippet: copy & paste into the page DevTools Console.
  // New behavior: when scraping runs it only collects image URLs per profile (no automatic downloads).
  // Use the floating UI or the exposed `badooScraper` object to start/stop and export images when ready.

  (function(){
    const FIRST = "#page-container > div > div > div:nth-child(3) > div.people-nearby__content > div:nth-child(1) > ul > li:nth-child(1) > div > button > span.csms-user-list-cell__content > span.csms-user-list-cell__media > span > span > span > span > span";
    const SECOND = "#app-root > div > div.modal-container > div > div > div > div > div > div > div > div > div.profile-card-full__content > div > div.profile-card__content-scroller > div > div > div:nth-child(1) > button";
    const THIRD = "#fullscreen-gallery > div.slider-gallery > div.slider-gallery-pages.is-horizontal.is-animated > div:nth-child(2)";
    const SCROLLBAR = "#app-root > div > div.modal-container > div > div > div > div > div > div > div > div > div > div.profile-card-full__content > div > div.profile-card__scroll-bar.profile-card__scroll-bar--centered";

    function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

    function waitForSelector(selector, timeout = 5000){
      return new Promise(resolve => {
        const start = Date.now();
        const iv = setInterval(() => {
          const el = document.querySelector(selector);
          if(el){ clearInterval(iv); resolve(el); }
          if(Date.now() - start > timeout){ clearInterval(iv); resolve(null); }
        }, 200);
      });
    }

    // helpers to extract image urls from gallery-like elements
    function extractUrlsFromGallery(gallery){
      if(!gallery) return [];
      const imgs = Array.from(gallery.querySelectorAll('img'));
      const srcs = imgs.map(i => i.src || i.getAttribute('data-src') || i.getAttribute('data-lazy')).filter(Boolean);
      if(srcs.length) return srcs;
      const slides = Array.from(gallery.querySelectorAll('div'));
      const bg = [];
      slides.forEach(s => {
        const style = s && s.style && s.style.backgroundImage;
        if(style){
          const m = style.match(/url\(["']?(.*?)["']?\)/);
          if(m && m[1]) bg.push(m[1]);
        }
      });
      return bg;
    }

    // global state
    window.__badoo_collectedProfiles = window.__badoo_collectedProfiles || [];
    window.__badoo_collecting = false;
    window.__badoo_stopRequested = false;

    async function collectImagesFromOpenProfile(){
      const collected = new Set();
      const scroller = await waitForSelector(SCROLLBAR, 2000);
      if(scroller){
        const maxSteps = 40;
        let lastCount = 0;
        for(let step=0; step<maxSteps; step++){
          Array.from(scroller.querySelectorAll('img')).forEach(img => {
            const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy');
            if(src) collected.add(src);
          });
          Array.from(scroller.querySelectorAll('div')).forEach(d => {
            const style = d && d.style && d.style.backgroundImage;
            if(style){
              const m = style.match(/url\(["']?(.*?)["']?\)/);
              if(m && m[1]) collected.add(m[1]);
            }
          });
          try{ scroller.scrollTop = scroller.scrollTop + Math.max(scroller.clientHeight, 300); }catch(e){}
          await sleep(400);
          if(collected.size === lastCount){ if(step >= maxSteps - 3) break; }
          lastCount = collected.size;
        }
      } else {
        const btn = await waitForSelector(SECOND, 1500);
        if(btn){ btn.click(); }
        await sleep(600);
        const gallery = await waitForSelector('#fullscreen-gallery', 3000);
        if(gallery){
          Array.from(gallery.querySelectorAll('img')).forEach(i => { if(i.src) collected.add(i.src); });
          const special = document.querySelector(THIRD);
          if(special) Array.from(special.querySelectorAll('img')).forEach(i => { if(i.src) collected.add(i.src); });
        }
        // close gallery if opened
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, which:27}));
        await sleep(250);
      }
      return Array.from(collected);
    }

    async function openProfile(el){ el.scrollIntoView({block:'center'}); await sleep(300); el.click(); await sleep(500); }
    async function closeProfile(){ document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, which:27})); await sleep(300); }

    async function startScrape(){
      if(window.__badoo_collecting){ console.warn('Already collecting'); return; }
      window.__badoo_collecting = true;
      window.__badoo_stopRequested = false;
      const els = Array.from(document.querySelectorAll(FIRST));
      console.log('Starting scrape — found', els.length, 'profiles');
      for(let i=0;i<els.length;i++){
        if(window.__badoo_stopRequested) break;
        try{
          await openProfile(els[i]);
          const urls = await collectImagesFromOpenProfile();
          window.__badoo_collectedProfiles.push({ index: i+1, urls, timestamp: Date.now() });
          await closeProfile();
        }catch(e){ console.error('Error processing item', i+1, e); try{ await closeProfile(); }catch(_){} }
        await sleep(350);
      }
      window.__badoo_collecting = false;
      console.log('Scrape finished — collected', window.__badoo_collectedProfiles.length, 'profiles');
    }

    function stopScrape(){
      if(!window.__badoo_collecting){ console.log('Not currently collecting'); return; }
      window.__badoo_stopRequested = true;
      console.log('Stop requested — scraper will stop after current profile');
    }

    async function exportProfileImages(profileIndex){
      const p = window.__badoo_collectedProfiles[profileIndex];
      if(!p) { console.warn('No profile at index', profileIndex); return; }
      for(let i=0;i<p.urls.length;i++){
        const url = p.urls[i];
        const ext = (()=>{ try{ return (new URL(url)).pathname.split('.').pop().split('?')[0] }catch(e){ return 'jpg' }})();
        const filename = `badoo_profile_${p.index}_img_${i+1}.${ext}`;
        const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        await sleep(200);
      }
      console.log('Exported', p.urls.length, 'images for profile', p.index);
    }

    async function exportAllCollectedImages(){
      for(let i=0;i<window.__badoo_collectedProfiles.length;i++){
        await exportProfileImages(i);
        await sleep(500);
      }
      console.log('Exported all collected images');
    }

    // small floating control UI
    function createControlUI(){
      if(document.getElementById('badoo-scraper-ui')) return;
      const panel = document.createElement('div');
      panel.id = 'badoo-scraper-ui';
      panel.style.position = 'fixed';
      panel.style.right = '12px';
      panel.style.bottom = '12px';
      panel.style.zIndex = 999999;
      panel.style.background = 'rgba(0,0,0,0.75)';
      panel.style.color = 'white';
      panel.style.padding = '8px';
      panel.style.borderRadius = '8px';
      panel.style.fontFamily = 'Arial, sans-serif';
      panel.style.fontSize = '12px';

      const startBtn = document.createElement('button'); startBtn.textContent = 'Start'; startBtn.style.marginRight='6px';
      const stopBtn = document.createElement('button'); stopBtn.textContent = 'Stop'; stopBtn.style.marginRight='6px';
      const exportBtn = document.createElement('button'); exportBtn.textContent = 'Export All';
      const info = document.createElement('div'); info.style.marginTop='6px'; info.textContent = 'Collected: 0';

      startBtn.onclick = ()=>{ startScrape(); };
      stopBtn.onclick = ()=>{ stopScrape(); };
      exportBtn.onclick = ()=>{ exportAllCollectedImages(); };

      panel.appendChild(startBtn); panel.appendChild(stopBtn); panel.appendChild(exportBtn); panel.appendChild(info);
      document.body.appendChild(panel);

      const iv = setInterval(()=>{
        const count = window.__badoo_collectedProfiles.length || 0;
        info.textContent = `Collected: ${count}`;
        if(!document.getElementById('badoo-scraper-ui')) clearInterval(iv);
      }, 800);
    }

    // expose control functions
    window.badooScraper = {
      startScrape,
      stopScrape,
      exportProfileImages,
      exportAllCollectedImages,
      createControlUI,
      state: window.__badoo_collectedProfiles,
    };

    createControlUI();
    console.log('download-images-snippet ready — use `badooScraper.startScrape()` to start. UI buttons available.');
  })();
