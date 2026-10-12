(() => {
  "use strict";
  const STORAGE_KEY = "harbor-pine-data";
  const $ = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
  const rooms = [
    {id:"coast-room",name:"Coastal King",type:"Room",price:149,capacity:2,rating:4.8,tag:"GUEST FAVORITE",size:"28 m²",features:["King bed","Garden view","Rain shower"],description:"A calm, light-filled room with natural textures and a little space to unwind.",art:"room-one"},
    {id:"garden-room",name:"Garden Twin",type:"Room",price:129,capacity:2,rating:4.6,tag:"EASY ESCAPE",size:"25 m²",features:["Twin beds","Garden view","Rain shower"],description:"A relaxed retreat with soft colors, thoughtful comforts, and room to recharge.",art:"room-two"},
    {id:"harbor-suite",name:"Harbor Suite",type:"Suite",price:229,capacity:3,rating:4.9,tag:"A LITTLE EXTRA",size:"42 m²",features:["King bed","Harbor view","Lounge area"],description:"A generous suite with a separate sitting area and views toward the water.",art:"room-three"},
    {id:"pine-suite",name:"Pine Family Suite",type:"Suite",price:269,capacity:5,rating:4.8,tag:"ROOM TOGETHER",size:"54 m²",features:["King + sofa bed","Lounge area","Family friendly"],description:"Space for the whole crew, with flexible sleeping and room to spend time together.",art:"room-two"},
    {id:"studio-room",name:"Quiet Studio",type:"Room",price:119,capacity:2,rating:4.5,tag:"SIMPLE & GOOD",size:"22 m²",features:["Queen bed","Work nook","Rain shower"],description:"A smaller, considered space for a solo trip or an easy weekend for two.",art:"room-one"},
    {id:"signature-suite",name:"Signature Suite",type:"Suite",price:319,capacity:4,rating:5.0,tag:"SIGNATURE STAY",size:"62 m²",features:["King bed","Panoramic view","Deep soaking tub"],description:"Our most spacious stay, with elevated details and a deep soaking tub.",art:"room-three"}
  ];
  const freshState=()=>({reservations:[],qaHistory:[],nextBooking:2001});
  let state=loadState(), selectedRoom=null, search={checkIn:"",checkOut:"",guests:2,nights:0};

  function loadState(){
    try{
      const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
      if(!parsed)return freshState();
      return {
        reservations:Array.isArray(parsed.reservations)?parsed.reservations.filter(x=>x&&typeof x.bookingNumber==="string").slice(0,100):[],
        qaHistory:Array.isArray(parsed.qaHistory)?parsed.qaHistory.slice(0,100):[],
        nextBooking:Number.isInteger(parsed.nextBooking)?parsed.nextBooking:2001
      };
    }catch(e){console.warn("Could not load saved hotel data",e);return freshState();}
  }
  function saveState(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));return true;}catch(e){toast("Could not save data in this browser.",true);return false;}}
  function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function toast(message,error=false){const el=document.createElement("div");el.className="toast"+(error?" error":"");el.textContent=message;$("toast-region").appendChild(el);setTimeout(()=>el.remove(),2700);}
  function parseDates(checkIn,checkOut){
    if(!checkIn||!checkOut)return {ok:false,message:"Please select both check-in and check-out dates."};
    const start=new Date(checkIn+"T12:00:00"),end=new Date(checkOut+"T12:00:00"),today=new Date();today.setHours(0,0,0,0);
    if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime()))return {ok:false,message:"Please enter valid dates."};
    if(start<today)return {ok:false,message:"Check-in cannot be in the past."};
    if(end<=start)return {ok:false,message:"Check-out must be after check-in."};
    const nights=Math.round((end-start)/86400000);
    if(nights>30)return {ok:false,message:"Demo stays can be up to 30 nights."};
    return {ok:true,nights};
  }
  function formatDate(value){if(!value)return "";return new Date(value+"T12:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});}
  function setMinDates(){
    const today=new Date(),localToday=new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);
    ["check-in","drawer-check-in"].forEach(id=>$(id).min=localToday);
    ["check-out","drawer-check-out"].forEach(id=>$(id).min=localToday);
    $("check-in").value=localToday;$("drawer-check-in").value=localToday;
    const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);const next=new Date(tomorrow.getTime()-tomorrow.getTimezoneOffset()*60000).toISOString().slice(0,10);
    $("check-out").value=next;$("drawer-check-out").value=next;
  }
  function updateCheckoutMin(inId,outId){const start=$(inId).value;$(outId).min=start||$("check-in").min;if($(outId).value&&start&&$(outId).value<=start){const next=new Date(start+"T12:00:00");next.setDate(next.getDate()+1);$(outId).value=new Date(next.getTime()-next.getTimezoneOffset()*60000).toISOString().slice(0,10);}}
  function renderRooms(){
    let list=rooms.slice(),filter=$("room-filter").value,sort=$("room-sort").value;
    if(filter!=="all")list=list.filter(r=>r.type===filter);
    if(sort==="price-low")list.sort((a,b)=>a.price-b.price);
    if(sort==="price-high")list.sort((a,b)=>b.price-a.price);
    if(sort==="capacity")list.sort((a,b)=>b.capacity-a.capacity);
    $("room-grid").innerHTML=list.map(r=>`<article class="room-card" data-testid="room-card" data-room-id="${r.id}" aria-label="${esc(r.name)}">
      <div class="room-visual" style="--room-bg:${r.id.includes("suite")?"#d4d9c9":"#e2d7c5"}"><span class="room-tag">${r.tag}</span><div class="room-art ${r.art}" aria-hidden="true"><span class="bed"></span><span class="pillow"></span><span class="plant"></span></div></div>
      <div class="room-details"><span class="room-type">${r.type.toUpperCase()} · ${r.size.toUpperCase()}</span><div class="room-title-row"><h3>${esc(r.name)}</h3><span class="room-rating">★ ${r.rating.toFixed(1)}</span></div><p class="room-description">${esc(r.description)}</p><div class="room-features">${r.features.map(f=>`<span>${esc(f)}</span>`).join("")}<span>Up to ${r.capacity} guests</span></div><div class="room-bottom"><div class="room-price"><strong>${money(r.price)}</strong><small>per night · demo rate</small></div><button class="room-book" type="button" data-action="book" data-id="${r.id}" data-testid="book-room-${r.id}">Choose room ↗</button></div></div>
    </article>`).join("");
    $("no-rooms").classList.toggle("hidden",list.length>0);$("room-grid").classList.toggle("hidden",list.length===0);
  }
  function readSearch(prefix){
    const ci=$(prefix+"check-in").value,co=$(prefix+"check-out").value,guests=Number($(prefix+"guests").value);
    const result=parseDates(ci,co);
    if(!result.ok){if(prefix==="")$("booking-feedback").textContent=result.message;else $("drawer-results").innerHTML=`<p class="form-error" role="alert">${esc(result.message)}</p>`;return false;}
    search={checkIn:ci,checkOut:co,guests,nights:result.nights};
    $("check-in").value=ci;$("check-out").value=co;$("guest-count").value=String(guests);
    $("drawer-check-in").value=ci;$("drawer-check-out").value=co;$("drawer-guests").value=String(guests);
    $("booking-feedback").textContent=`${result.nights} night${result.nights===1?"":"s"} · ${guests} guest${guests===1?"":"s"} · Demo availability shown below.`;
    renderAvailability();return true;
  }
  function renderAvailability(){
    const suitable=rooms.filter(r=>r.capacity>=search.guests);
    $("drawer-results").innerHTML=`<p class="availability-title">${search.nights} night${search.nights===1?"":"s"} · ${formatDate(search.checkIn)} – ${formatDate(search.checkOut)} · ${search.guests} guest${search.guests===1?"":"s"}</p>`+
    (suitable.length?suitable.map(r=>`<article class="availability-card" data-testid="availability-${r.id}" aria-label="${esc(r.name)}"><h3>${esc(r.name)}</h3><p>${r.capacity} guest capacity · ${r.features.slice(0,2).map(esc).join(" · ")}</p><div class="availability-row"><div><strong>${money(r.price*search.nights)}</strong><br><small>${money(r.price)} × ${search.nights} night${search.nights===1?"":"s"}</small></div><button type="button" data-action="book" data-id="${r.id}" data-testid="select-availability-${r.id}">Select room →</button></div></article>`).join(""):'<p>No room types fit this guest count. Try fewer guests.</p>');
  }
  function openLayer(id){closeLayers();$(id).classList.remove("hidden");$("overlay").classList.remove("hidden");document.body.classList.add("no-scroll");}
  function closeLayers(){["booking-drawer","guest-modal"].forEach(id=>$(id).classList.add("hidden"));$("overlay").classList.add("hidden");document.body.classList.remove("no-scroll");}
  function startBooking(id){
    selectedRoom=rooms.find(r=>r.id===id);if(!selectedRoom)return;
    if(!search.checkIn||!search.checkOut){const ci=$("check-in").value,co=$("check-out").value,validation=parseDates(ci,co);if(validation.ok)search={checkIn:ci,checkOut:co,guests:Number($("guest-count").value),nights:validation.nights};else{openLayer("booking-drawer");$("drawer-results").innerHTML=`<p class="drawer-hint">${esc(validation.message)} Enter your dates to continue.</p>`;return;}}
    if(selectedRoom.capacity<search.guests){toast("This room does not fit your selected guest count.",true);return;}
    $("selected-room-id").value=selectedRoom.id;
    $("selected-room").innerHTML=`<strong>${esc(selectedRoom.name)}</strong><span>${formatDate(search.checkIn)} – ${formatDate(search.checkOut)} · ${search.nights} night${search.nights===1?"":"s"} · ${search.guests} guest${search.guests===1?"":"s"}</span><span>${money(selectedRoom.price)} per night · Estimated total <b>${money(selectedRoom.price*search.nights)}</b></span>`;
    $("guest-form-view").classList.remove("hidden");$("booking-success").classList.add("hidden");$("guest-error").textContent="";
    openLayer("guest-modal");
  }
  function renderQA(){
    const h=state.qaHistory;$("qa-total").textContent=h.length;$("qa-passed").textContent=h.filter(x=>x.status==="PASS").length;$("qa-failed").textContent=h.filter(x=>x.status==="FAIL").length;
    $("qa-history").innerHTML=h.length?h.slice().reverse().map(x=>`<div class="qa-result ${x.status==="PASS"?"pass":"fail"}"><b>${esc(x.status)}</b><span>${esc(x.name)}<br><small>${esc(x.detail||"")}</small></span><small>${esc(x.time||"")}</small></div>`).join(""):'<p>No checks run yet.</p>';
  }
  function record(name,pass,detail){state.qaHistory.push({name,status:pass?"PASS":"FAIL",detail,time:new Date().toLocaleTimeString()});if(state.qaHistory.length>100)state.qaHistory=state.qaHistory.slice(-100);}
  function runTests(){
    const checks=[
      ["Room catalog loads",rooms.length>=5,`${rooms.length} room types defined`],
      ["Room IDs are unique",new Set(rooms.map(r=>r.id)).size===rooms.length,"No duplicate room IDs"],
      ["Rates are valid",rooms.every(r=>Number.isFinite(r.price)&&r.price>0),"All nightly rates are positive"],
      ["Capacity values are valid",rooms.every(r=>Number.isInteger(r.capacity)&&r.capacity>0),"All rooms have a positive guest capacity"],
      ["Date validation rejects same-day checkout",!parseDates("2030-06-10","2030-06-10").ok,"Checkout must be later than check-in"],
      ["Date validation accepts valid range",parseDates("2030-06-10","2030-06-12").nights===2,"Two-night date range calculates correctly"],
      ["Reservation storage is serializable",(()=>{try{return JSON.parse(JSON.stringify(state))!==null}catch(e){return false}})(),"Saved state can be JSON serialized"],
      ["Booking search controls exist",Boolean($("check-in")&&$("check-out")&&$("guest-count")),"Date and guest controls are present"],
      ["Guest form is available",Boolean($("guest-form")&&$("guest-email")),"Guest detail form is present"],
      ["Reservation history is an array",Array.isArray(state.reservations),"Reservation records are stored in a list"]
    ];
    checks.forEach(c=>record(c[0],c[1],c[2]));saveState();renderQA();toast(`${checks.filter(c=>c[1]).length}/${checks.length} demo checks passed.`);
  }

  $("search-form").addEventListener("submit",e=>{e.preventDefault();if(readSearch("")){openLayer("booking-drawer");renderAvailability();}});
  $("check-in").addEventListener("change",()=>updateCheckoutMin("check-in","check-out"));
  $("drawer-check-in").addEventListener("change",()=>updateCheckoutMin("drawer-check-in","drawer-check-out"));
  $("open-booking").addEventListener("click",()=>{openLayer("booking-drawer");$("drawer-check-in").value=$("check-in").value;$("drawer-check-out").value=$("check-out").value;$("drawer-guests").value=$("guest-count").value;});
  $("drawer-search-form").addEventListener("submit",e=>{e.preventDefault();readSearch("drawer-");});
  $("room-filter").addEventListener("change",renderRooms);$("room-sort").addEventListener("change",renderRooms);
  $("reset-room-filters").addEventListener("click",()=>{$("room-filter").value="all";$("room-sort").value="featured";renderRooms();});
  $("room-grid").addEventListener("click",e=>{const b=e.target.closest("[data-action=book]");if(b)startBooking(b.dataset.id);});
  $("drawer-results").addEventListener("click",e=>{const b=e.target.closest("[data-action=book]");if(b)startBooking(b.dataset.id);});
  document.querySelector("[data-close-booking]").addEventListener("click",closeLayers);
  document.querySelector("[data-close-modal]").addEventListener("click",closeLayers);
  $("overlay").addEventListener("click",closeLayers);
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeLayers();$("qa-panel").classList.add("hidden");$("main-nav").classList.remove("is-open");}});
  $("guest-form").addEventListener("submit",e=>{
    e.preventDefault();$("guest-error").textContent="";
    if(!selectedRoom){$("guest-error").textContent="Please select a room first.";return;}
    if(!$("guest-form").reportValidity())return;
    const form=new FormData(e.currentTarget),name=String(form.get("name")).trim(),email=String(form.get("email")).trim();
    if(name.length<2){$("guest-error").textContent="Please enter your full name.";return;}
    const booking={bookingNumber:String(state.nextBooking++),createdAt:new Date().toISOString(),roomId:selectedRoom.id,roomName:selectedRoom.name,checkIn:search.checkIn,checkOut:search.checkOut,nights:search.nights,guests:search.guests,guest:{name,email,phone:String(form.get("phone")||"").trim(),requests:String(form.get("requests")||"").trim()},total:selectedRoom.price*search.nights,status:"Confirmed (demo)"};
    state.reservations.unshift(booking);state.reservations=state.reservations.slice(0,100);saveState();
    $("guest-form-view").classList.add("hidden");$("booking-success").classList.remove("hidden");
    $("booking-success-message").textContent=`Reservation #${booking.bookingNumber} is confirmed for ${booking.guest.name}: ${booking.roomName}, ${formatDate(booking.checkIn)} to ${formatDate(booking.checkOut)}. Estimated total ${money(booking.total)}. No payment was taken.`;
    toast("Demo reservation confirmed.");
  });
  $("success-done").addEventListener("click",()=>{closeLayers();$("guest-form").reset();selectedRoom=null;});
  $("mobile-menu").addEventListener("click",()=>{const open=$("main-nav").classList.toggle("is-open");$("mobile-menu").setAttribute("aria-expanded",String(open));});
  document.querySelectorAll(".main-nav a").forEach(a=>a.addEventListener("click",()=>{$("main-nav").classList.remove("is-open");$("mobile-menu").setAttribute("aria-expanded","false");}));
  $("open-qa").addEventListener("click",()=>$("qa-panel").classList.remove("hidden"));
  $("close-qa").addEventListener("click",()=>$("qa-panel").classList.add("hidden"));
  $("run-tests").addEventListener("click",runTests);
  $("clear-history").addEventListener("click",()=>{state.qaHistory=[];saveState();renderQA();toast("QA history cleared.");});
  $("reset-data").addEventListener("click",()=>{if(!confirm("Reset all Harbor & Pine demo reservations and QA history?"))return;state=freshState();saveState();renderQA();closeLayers();$("qa-panel").classList.add("hidden");$("guest-form").reset();toast("All demo data reset.");});
  window.HarborPineV2={getRooms:()=>rooms.map(r=>({...r})),getState:()=>JSON.parse(JSON.stringify(state)),runTests,reset:()=>{state=freshState();saveState();renderQA();}};
  setMinDates();renderRooms();renderQA();
})();
