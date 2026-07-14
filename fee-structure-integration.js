/* FeeFlow integration bridge. The supplied manager's HTML, CSS and editor logic remain intact. */
(() => {
  const sessions = JSON.parse(localStorage.getItem('ff_sessions') || '[]');
  const session = sessions.length === 1 ? sessions.find(s => s.type === 'admin') : null;
  if (!session) { location.replace('portal.html'); return; }
  const schoolId = session.schoolId;
  const schools = JSON.parse(localStorage.getItem('ff_schools') || '[]');
  const school = schools.find(s => s.id === schoolId);
  if (!school) { location.replace('portal.html'); return; }
  const draftKey = 'ff_fee_manager_' + schoolId;
  const publishedKey = 'ff_fee_published_' + schoolId;
  const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');

  function blankState() {
    return {
      schoolName: school.name,
      activeLevel: 0, activeGrade: {}, activeTerm: 0, mobileView: 'editor',
      levels: [
        {name:'Primary', grades:['PP1','PP2','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6'].map(name=>({name,fees:[]}))},
        {name:'Junior School', grades:['Grade 7','Grade 8','Grade 9'].map(name=>({name,fees:[]}))},
        {name:'Secondary', grades:['Form 1','Form 2','Form 3','Form 4'].map(name=>({name,fees:[]}))}
      ]
    };
  }
  mkGrade = name => ({name, fees:[]});
  state = saved || blankState();
  state.schoolName = school.name;
  const schoolNameField=document.getElementById('schoolNameInput');if(schoolNameField){schoolNameField.value=school.name;schoolNameField.readOnly=true;schoolNameField.title='School name is managed in School Admin settings';}

  const actions = document.createElement('div');
  actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;align-items:center';
  actions.innerHTML = '<button id="ffBack" class="level-tab" style="opacity:1;background:var(--paper);color:var(--ink)">⌂ Home / Back to Admin</button><button id="ffTerms" class="level-tab" style="opacity:1">Edit Term Names</button><button id="ffSave" class="level-tab active">Save Draft</button><button id="ffPublish" class="level-tab active">Publish to Parents</button><span id="ffStatus" style="font-size:12px;color:var(--gold-light)"></span>';
  document.querySelector('header.topbar').appendChild(actions);
  document.getElementById('ffBack').onclick=()=>location.href='schooladmin.html';
  const storedTerms=JSON.parse(localStorage.getItem('ff_fee_term_names_'+schoolId)||'null');if(storedTerms?.length===3)TERMS.splice(0,3,...storedTerms);
  document.getElementById('ffTerms').onclick=()=>{const next=TERMS.map((t,i)=>prompt('Name for term '+(i+1)+':',t));if(next.every(x=>x&&x.trim())){TERMS.splice(0,3,...next.map(x=>x.trim()));localStorage.setItem('ff_fee_term_names_'+schoolId,JSON.stringify(TERMS));render();save(false);}};

  renderGradeRail = function(){
    const el=document.getElementById('gradeRail'),lvl=currentLevel(),gi=currentGradeIndex();el.innerHTML='';
    const h=document.createElement('h3');h.textContent=lvl.name+' levels';el.appendChild(h);
    lvl.grades.forEach((g,idx)=>{
      const item=document.createElement('div');item.className='grade-item'+(idx===gi?' active':'');item.title='Open '+g.name;item.onclick=()=>{state.activeGrade[state.activeLevel]=idx;render();};
      const label=document.createElement('span');label.textContent=g.name;label.style.cssText='flex:1;cursor:pointer';
      const count=document.createElement('span');count.className='count';count.textContent=g.fees.length+' fees';
      const edit=document.createElement('button');edit.className='grade-del';edit.textContent='✎';edit.title='Edit grade/form name';edit.style.opacity='.85';edit.onclick=e=>{e.stopPropagation();const name=prompt('Edit grade/form name:',g.name);if(name&&name.trim()){g.name=name.trim();save(false);render();}};
      const del=document.createElement('button');del.className='grade-del';del.textContent='✕';del.title='Delete grade/form';del.onclick=e=>{e.stopPropagation();if(lvl.grades.length===1){alert('At least one grade/form must remain.');return}if(confirm('Delete '+g.name+' and all of its fee items?')){lvl.grades.splice(idx,1);state.activeGrade[state.activeLevel]=Math.max(0,Math.min(idx,lvl.grades.length-1));save(false);render();}};
      const right=document.createElement('div');right.style.cssText='display:flex;align-items:center;gap:6px';right.append(count,edit,del);item.append(label,right);el.appendChild(item);
    });
    const add=document.createElement('button');add.className='add-grade-btn';add.textContent='+ Add grade / form';add.onclick=()=>{const name=prompt('Enter the new grade or form name:');if(!name||!name.trim())return;if(lvl.grades.some(g=>g.name.toLowerCase()===name.trim().toLowerCase())){alert('That grade or form already exists.');return}lvl.grades.push({name:name.trim(),fees:[]});state.activeGrade[state.activeLevel]=lvl.grades.length-1;save(false);render();};el.appendChild(add);
  };

  function save(show=true) {
    state.schoolName = school.name;
    localStorage.setItem(draftKey, JSON.stringify(state));
    if(show){document.getElementById('ffStatus').textContent='Draft saved';setTimeout(()=>document.getElementById('ffStatus').textContent='',1800);}
  }
  document.getElementById('ffSave').onclick=()=>save(true);
  document.getElementById('ffPublish').onclick=()=>{
    save(false);
    const publication={...JSON.parse(JSON.stringify(state)),schoolId,schoolName:school.name,paybill:school.paybill||'',publishedAt:Date.now(),publishedBy:session.name};
    localStorage.setItem(publishedKey,JSON.stringify(publication));
    const normalize=v=>String(v||'').replace(/[A-Z]$/,'').replace(/^Class /,'Grade ').trim().toLowerCase();
    const students=JSON.parse(localStorage.getItem('ff_students')||'[]');
    students.filter(st=>st.schoolId===schoolId).forEach(st=>{let grade=null;for(const level of publication.levels){grade=level.grades.find(g=>normalize(g.name)===normalize(st.class));if(grade)break;}if(grade){const expected=grade.fees.filter(f=>!f.boarderOnly||st.boarding===true).reduce((sum,f)=>sum+(f.amounts||[]).reduce((a,n)=>a+Number(n||0),0),0);st.total=expected;st.balance=Math.max(0,expected-Number(st.paid||0));st.status=st.balance===0?'paid':st.paid>0?'partial':'unpaid';}});
    localStorage.setItem('ff_students',JSON.stringify(students));
    const parents=JSON.parse(localStorage.getItem('ff_parents')||'[]').filter(p=>p.schoolId===schoolId);
    const notifications=JSON.parse(localStorage.getItem('ff_notifications')||'[]');
    parents.forEach((p,i)=>notifications.unshift({id:Date.now()+i,audience:'parent',schoolId,parentId:p.id,type:'fee-report',title:'New Fee Structure Published',body:`${school.name} published an updated fee structure. Open Fee Reports to view it.`,time:'Just now',unread:true}));
    localStorage.setItem('ff_notifications',JSON.stringify(notifications));
    document.getElementById('ffStatus').textContent='Published to '+parents.length+' parent account(s)';
  };
  document.addEventListener('input',()=>{clearTimeout(window.__ffSaveTimer);window.__ffSaveTimer=setTimeout(()=>save(false),400)},true);
  document.addEventListener('change',()=>save(false),true);
  document.addEventListener('click',e=>{if(e.target.closest('.add-grade-btn,.add-fee-btn,.del-row-btn,.grade-del,.term-chip,.level-tab'))setTimeout(()=>save(false),100)},true);
  render();
  // Ensure the preview uses the school's real paybill without altering the supplied template.
  const originalRenderPreview = renderPreview;
  renderPreview = function(){ originalRenderPreview(); const footer=document.querySelector('.doc-footer');if(footer)footer.innerHTML=`Payment via <strong>M-Pesa Paybill</strong> — Business No. <strong>${escapeHtml(school.paybill||'Not configured')}</strong>, Account: <strong>Learner admission number</strong>.<br>For queries, contact the school bursar's office.`; };
  renderPreview();
  window.addEventListener('storage',e=>{if(e.key==='ff_schools'){const latest=JSON.parse(e.newValue||'[]').find(x=>x.id===schoolId);if(latest){school.name=latest.name;school.paybill=latest.paybill;state.schoolName=latest.name;if(schoolNameField)schoolNameField.value=latest.name;renderPreview();}}});
})();
