/* FeeFlow — Kiswahili interface (opt-in).
   English is the default and the source of truth. Choosing "SW" stores ff.lang=sw and reloads; this file then
   swaps known phrases (exact text match) for Kiswahili as the page renders. Anything not in the dictionary
   stays in English — so it is safe, but coverage is partial: navigation, sign-in, buttons and the landing page.
   Legal pages and long explanations are intentionally left in English until a translator has reviewed them. */
(function () {
  'use strict';
  var KEY = 'ff.lang';
  var SW = {
    /* navigation */
    'Dashboard': 'Dashibodi', 'Students': 'Wanafunzi', 'Fee Structure': 'Muundo wa Ada', 'Payments': 'Malipo', 'Finance': 'Fedha',
    'Fee Ledger': 'Leja ya Ada', 'Outstanding': 'Madeni', 'M-Pesa Reconcile': 'Linganisha M-Pesa', 'Bursaries & Discounts': 'Ufadhili na Punguzo',
    'Operations': 'Shughuli', 'Tools': 'Zana', 'Bulk Reminders': 'Vikumbusho vya Pamoja', 'Receipts': 'Risiti', 'Reports': 'Ripoti',
    'Management': 'Usimamizi', 'Parent Directory': 'Orodha ya Wazazi', 'Classes': 'Madarasa', 'Settings': 'Mipangilio', 'Main': 'Kuu',
    'My Children': 'Watoto Wangu', 'Link a Child': 'Unganisha Mtoto', 'Notifications': 'Arifa', 'Profile': 'Wasifu',
    'Import pupils': 'Ingiza wanafunzi', 'Promote classes': 'Pandisha madarasa', 'Payment reversals': 'Kubatilisha malipo',
    'Instalments': 'Malipo ya awamu', 'Fee clearance': 'Hati ya kutodaiwa', 'Staff & roles': 'Wafanyakazi na majukumu',
    'Plan & billing': 'Mpango na ankara', 'Support': 'Msaada', 'Back to dashboard': 'Rudi kwenye dashibodi',
    'Arrears & Late Fees': 'Malimbikizo na Faini', 'Transport & Meals': 'Usafiri na Chakula', 'Fee History': 'Historia ya Ada',
    /* sign in / register */
    'Welcome back': 'Karibu tena', 'Sign in': 'Ingia', 'Register': 'Jisajili', 'Parent': 'Mzazi', 'School': 'Shule', 'Staff': 'Wafanyakazi',
    'Email address': 'Barua pepe', 'Password': 'Nenosiri', 'Confirm password': 'Thibitisha nenosiri', 'Repeat password': 'Rudia nenosiri',
    'Forgot your password?': 'Umesahau nenosiri?', 'Back': 'Rudi', 'Your full name': 'Jina lako kamili', 'Phone number': 'Namba ya simu',
    "Your child's school": 'Shule ya mtoto wako', "Child's full name": 'Jina kamili la mtoto', 'Class': 'Darasa', 'Create account': 'Fungua akaunti',
    'Create a parent account': 'Fungua akaunti ya mzazi', 'Register your school': 'Sajili shule yako', 'School name': 'Jina la shule',
    'Town / county': 'Mji / kaunti', 'Create school account': 'Fungua akaunti ya shule', 'Join school': 'Jiunge na shule',
    "Join your school's team": 'Jiunge na timu ya shule yako', 'Already registered?': 'Umeshajisajili?', 'Sign in instead': 'Ingia badala yake',
    'Check your email': 'Angalia barua pepe yako', 'Go to sign in': 'Nenda kuingia', 'Add your children': 'Ongeza watoto wako',
    'Primary school': 'Shule ya msingi', 'Secondary school': 'Shule ya upili', 'Primary & secondary': 'Msingi na upili',
    'What FeeFlow is': 'FeeFlow ni nini', 'What is FeeFlow?': 'FeeFlow ni nini?', 'School fees, sorted.': 'Ada za shule, zimepangwa.',
    'Sign out': 'Toka', 'Log out': 'Toka', 'Logout': 'Toka',
    /* common actions + words */
    'Cancel': 'Ghairi', 'Save': 'Hifadhi', 'Send': 'Tuma', 'Close': 'Funga', 'Print': 'Chapisha', 'Download': 'Pakua', 'Search': 'Tafuta',
    'Approve': 'Idhinisha', 'Reject': 'Kataa', 'Open': 'Fungua', 'Remove': 'Ondoa', 'Edit': 'Hariri', 'Delete': 'Futa', 'Add': 'Ongeza',
    'Preview': 'Hakiki', 'Loading…': 'Inapakia…', 'Name': 'Jina', 'Amount': 'Kiasi', 'Date': 'Tarehe', 'Status': 'Hali', 'Method': 'Njia',
    'Balance': 'Salio', 'Paid': 'Imelipwa', 'Partial': 'Sehemu', 'Unpaid': 'Haijalipwa', 'Pending': 'Inasubiri', 'Failed': 'Imeshindikana',
    'Balance due': 'Salio linalodaiwa', 'Fully paid': 'Imelipwa kikamilifu', 'Expected': 'Inayotarajiwa', 'Total': 'Jumla',
    'Overdue': 'Imechelewa', 'Upcoming': 'Inayokuja', 'Due': 'Tarehe ya mwisho', 'Receipt': 'Risiti', 'Subject': 'Mada',
    'Boarder': 'Mwanafunzi wa bweni', 'Day Scholar': 'Mwanafunzi wa kutwa', 'Admission No': 'Namba ya usajili', 'Gender': 'Jinsia',
    'Share balance on WhatsApp': 'Shiriki salio kupitia WhatsApp', 'Remind on WhatsApp': 'Kumbusha kwa WhatsApp',
    'Request reversal': 'Omba kubatilisha', 'New plan': 'Mpango mpya', 'Cancel plan': 'Futa mpango', 'Issue certificate': 'Toa hati',
    'Invite staff': 'Alika mfanyakazi', 'Send invite': 'Tuma mwaliko', 'New request': 'Ombi jipya', 'Send reply': 'Tuma jibu',
    'Owner': 'Mmiliki', 'Head teacher': 'Mwalimu mkuu', 'Bursar': 'Mhasibu', 'Secretary': 'Katibu',
    /* landing page */
    'Skip to content': 'Ruka hadi maudhui', 'Features': 'Vipengele', 'How it works': 'Jinsi inavyofanya kazi', 'Schools & parents': 'Shule na wazazi',
    'Privacy & security': 'Faragha na usalama', 'FAQ': 'Maswali', "I'm a parent": 'Mimi ni mzazi', 'Works on any phone': 'Inafanya kazi kwenye simu yoyote',
    'Free trial plan for every new school': 'Mpango wa majaribio bila malipo kwa kila shule mpya',
    'Built for Kenyan schools · CBC & 8-4-4': 'Imetengenezwa kwa shule za Kenya · CBC na 8-4-4',
    'What FeeFlow does': 'FeeFlow hufanya nini', 'Everything a bursar does, in one place': 'Kila kitu anachofanya mhasibu, mahali pamoja',
    'M-Pesa collection': 'Ukusanyaji kupitia M-Pesa', 'Reminders by SMS': 'Vikumbusho kwa SMS', 'Transport and meals': 'Usafiri na chakula',
    'A parent portal': 'Tovuti ya wazazi', 'Reports and exports': 'Ripoti na usafirishaji', 'Up and running in an afternoon': 'Anza kutumia ndani ya alasiri moja',
    'Register the school': 'Sajili shule', 'Set the fees': 'Weka ada', 'Parents join': 'Wazazi wanajiunga', 'Collect and track': 'Kusanya na fuatilia',
    'For schools and for parents': 'Kwa shule na kwa wazazi', 'School administrators': 'Wasimamizi wa shule', 'Parents and guardians': 'Wazazi na walezi',
    'Pay by M-Pesa from your phone': 'Lipa kwa M-Pesa kutoka simuni mwako', 'Keep receipts for every payment': 'Hifadhi risiti za kila malipo',
    'See exactly what is owed for each child': 'Ona kwa usahihi kinachodaiwa kwa kila mtoto',
    'Frequently asked': 'Maswali yanayoulizwa mara kwa mara', 'Questions': 'Maswali', 'Privacy Policy': 'Sera ya Faragha', 'Terms': 'Masharti',
    'Ready to make school fees simple?': 'Uko tayari kurahisisha ada za shule?', 'Pre-Primary': 'Awali', 'Junior School': 'Shule ya Sekondari Msingi',
    'Senior School': 'Shule ya Sekondari Juu'
  };
  var lang = 'en';
  try { lang = localStorage.getItem(KEY) === 'sw' ? 'sw' : 'en'; } catch (e) {}
  function norm(s) { return String(s).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
  function tr(s) { var k = norm(s); return Object.prototype.hasOwnProperty.call(SW, k) ? SW[k] : null; }

  function translateNode(root) {
    if (lang !== 'sw' || !root) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n, list = [];
    while ((n = w.nextNode())) list.push(n);
    list.forEach(function (t) {
      var p = t.parentNode; if (!p || /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.nodeName)) return;
      var v = t.nodeValue; if (!v || !v.trim()) return;
      var r = tr(v); if (r) t.nodeValue = v.replace(v.trim(), r);
    });
    var els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[aria-label],[title]') : [];
    Array.prototype.forEach.call(els, function (el) {
      ['placeholder', 'aria-label', 'title'].forEach(function (a) { var r = el.hasAttribute(a) && tr(el.getAttribute(a)); if (r) el.setAttribute(a, r); });
    });
  }

  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(function () { translateNode(document.body); }, 80); }

  function setLang(l) { try { localStorage.setItem(KEY, l === 'sw' ? 'sw' : 'en'); } catch (e) {} location.reload(); }

  function mountToggle() {
    if (document.getElementById('ffLang')) return;
    var b = document.createElement('button');
    b.id = 'ffLang'; b.type = 'button';
    b.className = 'ff-btn ff-btn-ghost ff-btn-sm ff-lang';
    b.setAttribute('aria-label', lang === 'sw' ? 'Switch to English' : 'Badilisha kuwa Kiswahili');
    b.textContent = lang === 'sw' ? 'EN' : 'SW';
    b.addEventListener('click', function () { setLang(lang === 'sw' ? 'en' : 'sw'); });
    var host = document.querySelector('.ff-topbar-right') || document.querySelector('.lp-head-cta') || document.querySelector('.ff-auth-main');
    if (host) host.insertBefore(b, host.firstChild); else { b.style.cssText = 'position:fixed;top:10px;right:10px;z-index:50'; document.body.appendChild(b); }
  }

  function start() {
    document.documentElement.setAttribute('lang', lang === 'sw' ? 'sw' : 'en');
    mountToggle();
    if (lang !== 'sw') return;
    translateNode(document.body);
    if (window.MutationObserver) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.FFI18N = { lang: lang, setLang: setLang, translate: translateNode, dictionary: SW };
})();
