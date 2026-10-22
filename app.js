/* PageSet stores the complete set of local profiles in one versioned value.
   Reading history belongs to a book; each reread is an independent record. */
const STORAGE_KEY = 'pageset.v1';
const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id = () => crypto.randomUUID();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0001-01-01' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const textValue = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// Imported JSON is untrusted. Validate every record before changing any data.
function validateProfile(profile) {
  if (!profile || !textValue(profile.name, 80) || !Array.isArray(profile.books) || profile.books.length > 10000) throw Error('The profile must have a name and a valid books array.');
  for (const book of profile.books) {
    if (!book || !textValue(book.title,300) || !textValue(book.author,200) || !Array.isArray(book.reads)) throw Error('Each book needs a title, author, and reading history.');
    for (const read of book.reads) {
      if (read && validDate(read.startDate) && validDate(read.endDate) && read.endDate < read.startDate) throw Error('End date must be on or after the start date.');
      if (!read || !validDate(read.startDate) || (read.endDate !== null && (!validDate(read.endDate) || read.endDate < read.startDate)) || (read.rating !== null && (!Number.isInteger(read.rating) || read.rating < 1 || read.rating > 5)) || typeof read.notes !== 'string' || read.notes.length > 20000) throw Error('A reading has invalid dates, rating, or notes.');
    }
  }
  // Generate fresh identifiers so importing twice cannot create ID collisions.
  return {id:id(), name:profile.name.trim(), books:profile.books.map(book => ({id:id(),title:book.title.trim(),author:book.author.trim(),reads:book.reads.map(read => ({id:id(),startDate:read.startDate,endDate:read.endDate,rating:read.rating,notes:read.notes}))}))};
}

function summarize(books, from='', through='') {
  const finished = books.flatMap(book => book.reads.filter(read => read.endDate && (!from || read.endDate >= from) && (!through || read.endDate <= through)).map(read => ({book,read})));
  const rated = finished.filter(({read}) => read.rating !== null);
  const authors = new Map(), months = new Map();
  for (const {book,read} of finished) {
    const key = book.author.trim().toLocaleLowerCase();
    if (!authors.has(key)) authors.set(key,{name:book.author,count:0,ratings:[]});
    const author = authors.get(key); author.count++;
    if (read.rating !== null) author.ratings.push(read.rating);
    const month = read.endDate.slice(0,7); months.set(month,(months.get(month)||0)+1);
  }
  const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
  return {count:finished.length,average:mean(rated.map(({read})=>read.rating)),days:mean(finished.map(({read})=>(Date.parse(read.endDate)-Date.parse(read.startDate))/86400000+1)),authors:[...authors.values()].map(a=>({...a,average:mean(a.ratings)})).sort((a,b)=>(b.average??-1)-(a.average??-1)||a.name.localeCompare(b.name)),months:[...months].sort(([a],[b])=>a.localeCompare(b))};
}

let state, storageBlocked = false, toastTimer;
function notify(message) { $('#message').textContent=message; $('#message').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#message').hidden=true,6500); }
function freshState() { const profile={id:id(),name:'My reading',books:[]}; return {version:1,activeId:profile.id,profiles:[profile]}; }
function load() {
  try {
    const raw=localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const data=JSON.parse(raw);
    if (data.version!==1 || !Array.isArray(data.profiles) || !data.profiles.length) throw Error();
    // Validation also strips unknown properties from saved data.
    const activeIndex=data.profiles.findIndex(p=>p.id===data.activeId);
    const profiles=data.profiles.map(validateProfile);
    return {version:1,profiles,activeId:profiles[Math.max(0,activeIndex)].id};
  } catch {
    storageBlocked=true;
    notify('Saved data could not be loaded. It has not been overwritten. Changes are disabled; check browser storage before continuing.');
    return freshState();
  }
}
const current = () => state.profiles.find(p=>p.id===state.activeId);
// Save a candidate first: failed writes must not leave the UI claiming success.
function commit(change) {
  if(storageBlocked) { notify('Browser storage is unavailable or unreadable. Changes cannot be saved.'); return false; }
  const next=structuredClone(state); change(next);
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(next)); state=next; render(); return true; }
  catch { notify('Could not save. Browser storage may be full or disabled. Export your profile to keep a backup.'); return false; }
}
const activeIn = data => data.profiles.find(p=>p.id===data.activeId);
function render() {
  $('#profile').innerHTML=state.profiles.map(p=>`<option value="${p.id}">${escapeHTML(p.name)}</option>`).join(''); $('#profile').value=state.activeId;
  $('#profile-name').textContent=current().name;
  renderBooks(); renderTrends();
}
function renderBooks() {
  const query=$('#search').value.trim().toLocaleLowerCase(), status=$('#status-filter').value;
  const books=current().books.filter(book => {
    const progress=book.reads.some(r=>!r.endDate), finished=book.reads.some(r=>r.endDate);
    return `${book.title} ${book.author}`.toLocaleLowerCase().includes(query) && (status==='all'||status==='unread'&&!book.reads.length||status==='progress'&&progress||status==='finished'&&finished);
  }).slice();
  const sort=$('#sort').value; if(sort==='recent') books.reverse(); else books.sort((a,b)=>a[sort].localeCompare(b[sort]));
  $('#book-count').textContent=`${books.length} of ${current().books.length} books`;
  $('#books').innerHTML=books.length ? books.map(book=>{
    const count=book.reads.filter(r=>r.endDate).length, progress=book.reads.filter(r=>!r.endDate).length;
    return `<article class="book-card"><h3>${escapeHTML(book.title)}</h3><p class="book-meta">${escapeHTML(book.author)}</p><span class="badge">${progress ? `${progress} in progress · `:''}${count ? `Read ${count} ${count===1?'time':'times'}`:progress?'Not yet finished':'Not started'}</span><div class="book-actions"><button data-action="read" data-book="${book.id}">+ Log a reading</button><button data-action="edit-book" data-book="${book.id}">Edit book</button><button class="danger" data-action="delete-book" data-book="${book.id}">Delete</button></div>${book.reads.length ? `<details><summary>Reading history (${book.reads.length})</summary>${book.reads.slice().sort((a,b)=>b.startDate.localeCompare(a.startDate)).map(read=>`<div class="reading"><div class="reading-head"><span>${read.startDate} → ${read.endDate||'In progress'}</span><span class="stars" aria-label="${read.rating===null?'Unrated':read.rating+' out of 5 stars'}">${read.rating===null?'Unrated':'★'.repeat(read.rating)}</span></div>${read.notes?`<p>${escapeHTML(read.notes)}</p>`:''}<button data-action="edit-read" data-book="${book.id}" data-read="${read.id}">Edit reading</button> <button class="danger" data-action="delete-read" data-book="${book.id}" data-read="${read.id}">Delete reading</button></div>`).join('')}</details>`:''}</article>`;
  }).join('') : `<div class="empty"><strong>${current().books.length?'No matching books.':'Your next chapter starts here.'}</strong>${current().books.length?'Try another search or status filter.':'Add your first book, then log a reading whenever you start or finish it.'}</div>`;
}
function renderTrends() {
  const from=$('#from').value, through=$('#through').value, invalid=from&&through&&from>through;
  $('#range-error').textContent=invalid?'Choose an end date on or after the start date.':'';
  $('#stats').hidden=!!invalid; $('.trend-grid').hidden=!!invalid; if(invalid)return;
  const stats=summarize(current().books,from,through);
  $('#stats').innerHTML=[[stats.count,'Completed readings'],[stats.average===null?'—':stats.average.toFixed(1)+' / 5','Average rating'],[stats.days===null?'—':stats.days.toFixed(1),'Average days per reading']].map(([value,label])=>`<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  $('#authors').innerHTML=stats.authors.length?`<table><thead><tr><th>Author</th><th>Reads</th><th>Rating</th></tr></thead><tbody>${stats.authors.map(a=>`<tr><td>${escapeHTML(a.name)}</td><td>${a.count}</td><td>${a.average===null?'Unrated':a.average.toFixed(1)+' / 5'}${a.ratings.length?` <small>(${a.ratings.length})</small>`:''}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Finish a reading to see your authors here.</p>';
  const max=Math.max(1,...stats.months.map(([,n])=>n));
  $('#months').innerHTML=stats.months.length?stats.months.map(([month,n])=>`<div class="bar-row"><span>${month}</span><div class="bar-track"><div class="bar" style="width:${n/max*100}%"></div></div><span>${n}</span></div>`).join(''):'<p class="muted">No completed readings in this date range.</p>';
}
function openEditor(title, fields, onSave) {
  $('#editor-title').textContent=title; $('#editor-fields').innerHTML=fields; $('#form-error').textContent='';
  $('#editor-form').onsubmit=event=>{ event.preventDefault(); try { if(onSave(new FormData(event.target))) $('#editor').close(); } catch(error){ $('#form-error').textContent=error.message; } };
  $('#editor').showModal();
}
function editBook(book) {
  openEditor(book?'Edit book':'Add a book',`<label>Title<input name="title" required maxlength="300" value="${escapeHTML(book?.title||'')}"></label><label>Author<input name="author" required maxlength="200" value="${escapeHTML(book?.author||'')}"></label>`,form=>{
    const values={title:form.get('title').trim(),author:form.get('author').trim()};
    validateProfile({name:'Check',books:[{...values,reads:[]}]});
    return commit(data=>{const books=activeIn(data).books;if(book)Object.assign(books.find(b=>b.id===book.id),values);else books.push({id:id(),...values,reads:[]});});
  });
}
function editRead(book, read) {
  openEditor(read?'Edit reading':'Log a reading',`<p class="muted">${escapeHTML(book.title)}</p><div class="field-row"><label>Start date<input name="startDate" type="date" min="0001-01-01" required value="${read?.startDate||today()}"></label><label>End date (optional)<input name="endDate" type="date" min="0001-01-01" value="${read?.endDate||''}"></label></div><p class="muted">Leave the end date empty for a reading in progress.</p><label>Rating<select name="rating"><option value="">Unrated</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${read?.rating===n?'selected':''}>${n} ${n===1?'star':'stars'}</option>`).join('')}</select></label><label>Notes<textarea name="notes" maxlength="20000">${escapeHTML(read?.notes||'')}</textarea></label>`,form=>{
    const values={startDate:form.get('startDate'),endDate:form.get('endDate')||null,rating:form.get('rating')?Number(form.get('rating')):null,notes:form.get('notes')};
    validateProfile({name:'Check',books:[{...book,reads:[values]}]});
    return commit(data=>{const reads=activeIn(data).books.find(b=>b.id===book.id).reads;if(read)Object.assign(reads.find(r=>r.id===read.id),values);else reads.push({id:id(),...values});});
  });
}
function initialize() {
  state=load(); render();
  $('#add-book').onclick=()=>editBook();
  $('#new-profile').onclick=()=>openEditor('New profile','<label>Profile name<input name="name" required maxlength="80"></label>',form=>{
    const name=form.get('name').trim(); if(!name)throw Error('Enter a profile name.');
    return commit(data=>{const profile={id:id(),name,books:[]};data.profiles.push(profile);data.activeId=profile.id;});
  });
  $('#profile').onchange=event=>{const selected=event.target.value;if(!commit(data=>data.activeId=selected))render();};
  $('#delete-profile').onclick=()=>{if(confirm(`Delete “${current().name}” and all its books? This cannot be undone.`))commit(data=>{data.profiles=data.profiles.filter(p=>p.id!==data.activeId);if(!data.profiles.length)Object.assign(data,freshState());else data.activeId=data.profiles[0].id;});};
  for(const selector of ['#search','#status-filter','#sort']) $(selector).addEventListener('input',renderBooks);
  for(const selector of ['#from','#through']) $(selector).addEventListener('input',renderTrends);
  $('#all-time').onclick=()=>{$('#from').value='';$('#through').value='';renderTrends();};
  for(const view of ['library','trends']) {
    const tab=$(`#${view}-tab`);
    tab.onclick=()=>{for(const v of ['library','trends']){const active=v===view;$(`#${v}`).hidden=!active;$(`#${v}-tab`).setAttribute('aria-selected',String(active));$(`#${v}-tab`).tabIndex=active?0:-1;}};
    tab.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const target=event.key==='Home'?'library':event.key==='End'?'trends':view==='library'?'trends':'library';$(`#${target}-tab`).click();$(`#${target}-tab`).focus();}};
  }
  $('#close-editor').onclick=$('#cancel-editor').onclick=()=>$('#editor').close();
  $('#books').onclick=event=>{
    const button=event.target.closest('button[data-action]');if(!button)return;
    const book=current().books.find(b=>b.id===button.dataset.book),read=book.reads.find(r=>r.id===button.dataset.read);
    switch(button.dataset.action){
      case 'read':editRead(book);break;
      case 'edit-book':editBook(book);break;
      case 'edit-read':editRead(book,read);break;
      case 'delete-book':if(confirm(`Delete “${book.title}” and its reading history?`))commit(data=>{activeIn(data).books=activeIn(data).books.filter(b=>b.id!==book.id);});break;
      case 'delete-read':if(confirm('Delete this reading?'))commit(data=>{const b=activeIn(data).books.find(b=>b.id===book.id);b.reads=b.reads.filter(r=>r.id!==read.id);});break;
    }
  };
  $('#export').onclick=()=>{
    const blob=new Blob([JSON.stringify({format:'pageset',version:1,profile:current()},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`pageset-${current().name.replace(/[^a-z0-9]/gi,'-')}-${today()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('#import').onclick=()=>$('#import-file').click();
  $('#import-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    try {
      if(file.size>10*1024*1024)throw Error('Choose a JSON file smaller than 10 MB.');
      const data=JSON.parse(await file.text());
      if(data.format!=='pageset'||data.version!==1)throw Error('Choose a PageSet version 1 profile export.');
      const profile=validateProfile(data.profile);
      // Import creates a separate profile; it never replaces an existing library.
      if(commit(next=>{next.profiles.push(profile);next.activeId=profile.id;}))notify(`Imported ${profile.books.length} books into “${profile.name}”.`);
    } catch(error) {notify(error instanceof SyntaxError?'This file is not valid JSON.':error.message);}
    finally {event.target.value='';}
  };
  // Prevent a stale tab from overwriting changes saved by another tab.
  window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY||event.key===null){$('#editor').close();storageBlocked=false;state=load();render();notify('Profiles refreshed after a change in another tab.');}});
}
if(typeof document!=='undefined') initialize();
if(typeof module!=='undefined') module.exports={validateProfile,summarize,validDate,escapeHTML};
