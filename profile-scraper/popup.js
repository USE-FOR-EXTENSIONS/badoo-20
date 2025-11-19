const $ = id => document.getElementById(id);
const status = $('status');
function setStatus(s){ if(status) status.textContent = s; }

async function sendToActive(msg){
  try{
    const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(!tab) return setStatus('No active tab');
    chrome.tabs.sendMessage(tab.id, msg, (resp)=>{
      if(chrome.runtime.lastError){
        setStatus('Injecting content script...');
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] }).then(()=>{
          setTimeout(()=> chrome.tabs.sendMessage(tab.id, msg, (r)=>{ if(chrome.runtime.lastError) setStatus('Error: '+(chrome.runtime.lastError.message||'')); else setStatus('Sent'); }), 300);
        }).catch(e => setStatus('Injection failed'));
      } else setStatus('Sent');
    });
  }catch(e){ setStatus('send error'); }
}

$('start').addEventListener('click', async ()=>{ setStatus('Starting...'); await sendToActive({type:'start_profile_scrape', cfg:{}}); });
$('stop').addEventListener('click', async ()=>{ setStatus('Stopping...'); await sendToActive({type:'stop_profile_scrape'}); });
$('exportAll').addEventListener('click', async ()=>{
  setStatus('Exporting...');
  chrome.runtime.sendMessage({type:'export_profile_images', mode:'all'}, (resp)=>{ if(resp && resp.started) setStatus('Export started'); else setStatus('Export request sent'); });
});

// Profiles list UI
const listEl = document.getElementById('profiles-list');
const refreshBtn = document.getElementById('refreshList');

function renderProfiles(profiles){
  if(!listEl) return;
  listEl.innerHTML = '';
  if(!profiles || !profiles.length){ listEl.textContent = 'No profiles collected yet.'; return; }
  profiles.forEach((p, idx) => {
    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.justifyContent = 'space-between'; row.style.alignItems = 'center'; row.style.marginBottom = '8px';
    const info = document.createElement('div'); info.style.flex = '1';
    const title = document.createElement('div'); title.textContent = `#${idx+1} ${p.name||'(no name)'} ${p.age||''}`; title.style.fontWeight = '600';
    const meta = document.createElement('div'); meta.textContent = `${(p.images && p.images.length) ? p.images.length + ' images' : (p.image ? '1 image' : '0 images')}`; meta.style.opacity = '0.8'; meta.style.fontSize = '12px';
    info.appendChild(title); info.appendChild(meta);
    const actions = document.createElement('div');
    const ex = document.createElement('button'); ex.textContent = 'Export'; ex.style.marginRight='6px';
    const rem = document.createElement('button'); rem.textContent = 'Remove';
    ex.onclick = ()=>{ setStatus(`Exporting profile ${idx+1}...`); chrome.runtime.sendMessage({type:'export_profile_images', mode:{index: idx}}, (resp)=>{ if(resp && resp.started) setStatus('Export started'); else setStatus('Export request sent'); }); };
    rem.onclick = ()=>{ if(!confirm('Remove profile from collected list?')) return; chrome.storage.local.get({ profile_only_profiles: [] }, (res)=>{ const arr = Array.isArray(res.profile_only_profiles) ? res.profile_only_profiles : []; arr.splice(idx,1); chrome.storage.local.set({ profile_only_profiles: arr }, ()=>{ setStatus('Profile removed'); loadAndRender(); }); }); };
    actions.appendChild(ex); actions.appendChild(rem);
    row.appendChild(info); row.appendChild(actions);
    listEl.appendChild(row);
  });
}

function loadAndRender(){
  chrome.storage.local.get({ profile_only_profiles: [] }, (res)=>{ const arr = Array.isArray(res.profile_only_profiles) ? res.profile_only_profiles : []; renderProfiles(arr); });
}

refreshBtn && refreshBtn.addEventListener('click', ()=>{ loadAndRender(); setStatus('List refreshed'); });

// auto-load on popup open
loadAndRender();
