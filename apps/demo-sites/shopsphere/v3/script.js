(() => {
  "use strict";
  const STORAGE_KEY = "shopsphere-data";
  const money = value => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(value);
  const $ = id => document.getElementById(id);
  const products = [
    {id:1,name:"Studio Table Lamp",category:"Home",price:68,rating:4.8,reviews:124,description:"Warm light for slower evenings.",badge:"BESTSELLER",bg:"#e8d8c4",art:"art-lamp"},
    {id:2,name:"Everyday Ceramic Mug",category:"Home",price:24,rating:4.7,reviews:86,description:"A handmade feel for daily rituals.",badge:"",bg:"#e5ddd1",art:"art-mug"},
    {id:3,name:"Cloud Wireless Headphones",category:"Tech",price:89,rating:4.9,reviews:203,description:"Clear sound, softer edges.",badge:"POPULAR",bg:"#d7dfd2",art:"art-headphones"},
    {id:4,name:"Botanical Hand Wash",category:"Wellness",price:19,rating:4.5,reviews:57,description:"A fresh start, morning and night.",badge:"",bg:"#d9e0d1",art:"art-bottle"},
    {id:5,name:"Weekend Carryall",category:"Style",price:54,rating:4.6,reviews:92,description:"Room for all the little things.",badge:"NEW",bg:"#ead9c9",art:"art-bag"},
    {id:6,name:"Pocket Bluetooth Speaker",category:"Tech",price:46,rating:4.4,reviews:73,description:"Small size, room-filling sound.",badge:"",bg:"#d7dcd3",art:"art-speaker"},
    {id:7,name:"Little Leaf Planter",category:"Home",price:32,rating:4.8,reviews:118,description:"A quiet green corner, made easy.",badge:"",bg:"#e7dfcf",art:"art-plant"},
    {id:8,name:"Minimal Everyday Watch",category:"Style",price:112,rating:4.7,reviews:61,description:"A considered detail for every day.",badge:"",bg:"#e6d7c4",art:"art-watch"},
    {id:9,name:"Linen Notes Journal",category:"Style",price:18,rating:4.3,reviews:49,description:"Make space for a few good thoughts.",badge:"",bg:"#d8dfcf",art:"art-notebook"},
    {id:10,name:"Evening Ritual Candle",category:"Wellness",price:27,rating:4.6,reviews:141,description:"Soft cedar, amber, and a little calm.",badge:"FAVORITE",bg:"#ead9c9",art:"art-candle"},
    {id:11,name:"Desk Companion Speaker",category:"Tech",price:74,rating:4.5,reviews:38,description:"A cleaner sound for your workspace.",badge:"",bg:"#d6dcd3",art:"art-speaker"},
    {id:12,name:"Soft Shape Planter",category:"Home",price:39,rating:4.9,reviews:97,description:"An easy home for your favorite plant.",badge:"",bg:"#e8ddce",art:"art-plant"}
  ];
  const defaultState = () => ({cart:[],wishlist:[],orders:[],qaHistory:[],nextOrder:1001});
  let state = loadState();
  let activeDrawer = null;
  let lastOrder = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return {
        cart:Array.isArray(parsed.cart)?parsed.cart.filter(x=>products.some(p=>p.id===x.productId)&&Number.isInteger(x.qty)&&x.qty>0):[],
        wishlist:Array.isArray(parsed.wishlist)?parsed.wishlist.filter(id=>products.some(p=>p.id===id)) : [],
        orders:Array.isArray(parsed.orders)?parsed.orders.filter(x=>x&&typeof x.orderNumber==="string").slice(0,100):[],
        qaHistory:Array.isArray(parsed.qaHistory)?parsed.qaHistory.slice(0,100):[],
        nextOrder:Number.isInteger(parsed.nextOrder)?parsed.nextOrder:1001
      };
    } catch (error) {
      console.warn("Could not load ShopSphere data:", error);
      return defaultState();
    }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); return true; }
    catch (error) { console.error("Could not save ShopSphere data:",error); toast("Could not save data in this browser.",true); return false; }
  }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function getProduct(id) { return products.find(p=>p.id===id); }
  function cartCount() { return state.cart.reduce((sum,line)=>sum+line.qty,0); }
  function subtotal() { return state.cart.reduce((sum,line)=>sum+getProduct(line.productId).price*line.qty,0); }
  function toast(message,error=false) {
    const el=document.createElement("div"); el.className="toast"+(error?" error":""); el.textContent=message; $("toast-region").appendChild(el);
    window.setTimeout(()=>el.remove(),2600);
  }
  function artMarkup(product,mini=false) { return `<div class="product-art ${product.art}" aria-hidden="true"></div>`; }
  function renderProducts() {
    const query=$("search-input").value.trim().toLowerCase();
    const category=$("category-filter").value;
    const max=Number($("max-price").value);
    const sort=$("sort-filter").value;
    let list=products.filter(p=>(category==="all"||p.category===category)&&p.price<=max&&`${p.name} ${p.category} ${p.description}`.toLowerCase().includes(query));
    if(sort==="price-low") list.sort((a,b)=>a.price-b.price);
    if(sort==="price-high") list.sort((a,b)=>b.price-a.price);
    if(sort==="rating") list.sort((a,b)=>b.rating-a.rating);
    if(sort==="name") list.sort((a,b)=>a.name.localeCompare(b.name));
    $("result-count").textContent=`${list.length} product${list.length===1?"":"s"}`;
    $("price-label").textContent=money(max);
    $("active-filter-note").textContent=[category!=="all"?category:null,query?`Search: “${query}”`:null,max<200?`Up to ${money(max)}`:null].filter(Boolean).join(" · ");
    $("product-grid").innerHTML=list.map(p=>`<article class="product-card" data-testid="product-card" data-product-id="${p.id}" aria-label="${escapeHTML(p.name)}">
      <div class="product-visual" style="--product-bg:${p.bg}">${p.badge?`<span class="product-badge">${p.badge}</span>`:""}<button class="wish-button ${state.wishlist.includes(p.id)?"is-saved":""}" data-action="wishlist" data-id="${p.id}" aria-label="${state.wishlist.includes(p.id)?"Remove from":"Add to"} wishlist" aria-pressed="${state.wishlist.includes(p.id)}" data-testid="wishlist-product-${p.id}">${state.wishlist.includes(p.id)?"♥":"♡"}</button>${artMarkup(p)}</div>
      <div class="product-info"><div class="product-meta"><span>${p.category}</span><span class="rating">★ ${p.rating} <span style="color:#888">(${p.reviews})</span></span></div><h3 class="product-title">${escapeHTML(p.name)}</h3><p class="product-description">${escapeHTML(p.description)}</p><div class="product-bottom"><span class="product-price">${money(p.price)}</span><button class="add-button" data-action="add" data-id="${p.id}" data-testid="add-to-cart-${p.id}">+ Add to cart</button></div></div>
    </article>`).join("");
    $("product-grid").classList.toggle("hidden",list.length===0);
    $("empty-state").classList.toggle("hidden",list.length!==0);
  }
  function renderHeader() { $("cart-count").textContent=cartCount(); $("wishlist-count").textContent=state.wishlist.length; }
  function renderCart() {
    $("drawer-cart-count").textContent=`(${cartCount()})`; $("cart-subtotal").textContent=money(subtotal()); $("checkout-subtotal").textContent=money(subtotal());
    $("shipping-note").textContent=subtotal()>=50?"You qualify for free demo shipping!":"Shipping calculated at checkout.";
    $("checkout-button").disabled=state.cart.length===0;
    if(!state.cart.length){$("cart-items").innerHTML='<div class="drawer-empty"><strong>Your cart is taking a break.</strong>Find something lovely to bring home.</div>';return;}
    $("cart-items").innerHTML=state.cart.map(line=>{const p=getProduct(line.productId);return `<div class="cart-line" data-testid="cart-line-${p.id}"><div class="mini-visual" style="background:${p.bg}">${artMarkup(p,true)}</div><div><h3>${escapeHTML(p.name)}</h3><div class="line-meta">${money(p.price)} each</div><div class="quantity-control"><button data-action="qty" data-id="${p.id}" data-delta="-1" aria-label="Decrease ${escapeHTML(p.name)} quantity" data-testid="decrease-qty-${p.id}">−</button><span data-testid="quantity-${p.id}">${line.qty}</span><button data-action="qty" data-id="${p.id}" data-delta="1" aria-label="Increase ${escapeHTML(p.name)} quantity" data-testid="increase-qty-${p.id}">+</button></div><button class="remove-link" data-action="remove" data-id="${p.id}" data-testid="remove-cart-${p.id}">Remove</button></div><strong class="line-price">${money(p.price*line.qty)}</strong></div>`}).join("");
  }
  function renderWishlist() {
    if(!state.wishlist.length){$("wishlist-items").innerHTML='<div class="drawer-empty"><strong>Keep the good ones close.</strong>Tap the heart on any product to save it here.</div>';return;}
    $("wishlist-items").innerHTML=state.wishlist.map(id=>{const p=getProduct(id);return `<div class="wishlist-line"><div class="mini-visual" style="background:${p.bg}">${artMarkup(p,true)}</div><div><h3>${escapeHTML(p.name)}</h3><p>${money(p.price)}</p><button data-action="wish-add" data-id="${p.id}">Add to cart</button><button data-action="wishlist" data-id="${p.id}">Remove</button></div></div>`}).join("");
  }
  function renderAll(){renderHeader();renderProducts();renderCart();renderWishlist();renderQA();}
  function addToCart(id){const line=state.cart.find(x=>x.productId===id);if(line)line.qty=Math.min(99,line.qty+1);else state.cart.push({productId:id,qty:1});saveState();renderHeader();renderCart();toast(`${getProduct(id).name} added to cart.`);}
  function toggleWishlist(id){if(state.wishlist.includes(id))state.wishlist=state.wishlist.filter(x=>x!==id);else state.wishlist.push(id);saveState();renderHeader();renderProducts();renderWishlist();toast(state.wishlist.includes(id)?"Saved to wishlist.":"Removed from wishlist.");}
  function changeQty(id,delta){const line=state.cart.find(x=>x.productId===id);if(!line)return;line.qty+=delta;if(line.qty<=0)state.cart=state.cart.filter(x=>x.productId!==id);if(line.qty>99)line.qty=99;saveState();renderHeader();renderCart();}
  function removeFromCart(id){state.cart=state.cart.filter(x=>x.productId!==id);saveState();renderHeader();renderCart();toast("Item removed from cart.");}
  function openLayer(id){closeLayers();$(id).classList.remove("hidden");$("overlay").classList.remove("hidden");document.body.classList.add("no-scroll");activeDrawer=id;}
  function closeLayers(){["cart-drawer","wishlist-drawer","checkout-modal"].forEach(id=>$(id).classList.add("hidden"));$("overlay").classList.add("hidden");document.body.classList.remove("no-scroll");activeDrawer=null;}
  function openQA(){ $("qa-panel").classList.remove("hidden"); }
  function renderQA(){
    const history=state.qaHistory;
    $("qa-total").textContent=history.length;
    $("qa-passed").textContent=history.filter(x=>x.status==="PASS").length;
    $("qa-failed").textContent=history.filter(x=>x.status==="FAIL").length;
    $("qa-history").innerHTML=history.length?history.slice().reverse().map(x=>`<div class="qa-result ${x.status==="PASS"?"pass":"fail"}"><b>${escapeHTML(x.status)}</b><span>${escapeHTML(x.name)}<br><small>${escapeHTML(x.detail||"")}</small></span><small>${escapeHTML(x.time||"")}</small></div>`).join(""):'<p class="muted">No checks run yet.</p>';
  }
  function recordCheck(name,pass,detail){state.qaHistory.push({name,status:pass?"PASS":"FAIL",detail,time:new Date().toLocaleTimeString()});if(state.qaHistory.length>100)state.qaHistory=state.qaHistory.slice(-100);}
  function runTests(){
    const originalCart=JSON.stringify(state.cart),originalWish=JSON.stringify(state.wishlist);
    const checks=[
      ["Product catalog loads",products.length>=10,`${products.length} products defined`],
      ["Product IDs are unique",new Set(products.map(p=>p.id)).size===products.length,"No duplicate product IDs"],
      ["Prices are valid",products.every(p=>Number.isFinite(p.price)&&p.price>0),"All product prices are positive numbers"],
      ["Cart subtotal is numeric",Number.isFinite(subtotal())&&subtotal()>=0,`Current subtotal: ${money(subtotal())}`],
      ["Wishlist IDs are valid",state.wishlist.every(id=>products.some(p=>p.id===id)),"Every saved item exists in the catalog"],
      ["Cart quantities are valid",state.cart.every(x=>Number.isInteger(x.qty)&&x.qty>0&&x.qty<=99),"Quantities are within 1–99"],
      ["Saved state serializes",(()=>{try{return JSON.parse(JSON.stringify(state))!==null}catch(e){return false}})(),"State can be JSON serialized"],
      ["Search field is available",Boolean($("search-input")),"Search input is present"],
      ["Checkout is disabled for empty cart",state.cart.length>0||$("checkout-button").disabled,"Checkout button reflects cart state"]
    ];
    checks.forEach(c=>recordCheck(c[0],c[1],c[2]));
    saveState();renderQA();toast(`${checks.filter(c=>c[1]).length}/${checks.length} demo checks passed.`);
  }
  $("search-form").addEventListener("submit",e=>{e.preventDefault();renderProducts();$("catalog").scrollIntoView({behavior:"smooth"});});
  $("search-input").addEventListener("input",renderProducts);
  $("category-filter").addEventListener("change",renderProducts);
  $("sort-filter").addEventListener("change",renderProducts);
  $("max-price").addEventListener("input",renderProducts);
  $("clear-filters").addEventListener("click",()=>{$("search-input").value="";$("category-filter").value="all";$("sort-filter").value="featured";$("max-price").value="200";renderProducts();});
  $("empty-reset").addEventListener("click",()=>$("clear-filters").click());
  $("product-grid").addEventListener("click",e=>{const btn=e.target.closest("[data-action]");if(!btn)return;const id=Number(btn.dataset.id);if(btn.dataset.action==="add")addToCart(id);if(btn.dataset.action==="wishlist")toggleWishlist(id);});
  $("cart-items").addEventListener("click",e=>{const btn=e.target.closest("[data-action]");if(!btn)return;const id=Number(btn.dataset.id);if(btn.dataset.action==="qty")changeQty(id,Number(btn.dataset.delta));if(btn.dataset.action==="remove")removeFromCart(id);});
  $("wishlist-items").addEventListener("click",e=>{const btn=e.target.closest("[data-action]");if(!btn)return;const id=Number(btn.dataset.id);if(btn.dataset.action==="wish-add")addToCart(id);if(btn.dataset.action==="wishlist")toggleWishlist(id);});
  $("cart-toggle").addEventListener("click",()=>{openLayer("cart-drawer");renderCart();});
  $("wishlist-toggle").addEventListener("click",()=>{openLayer("wishlist-drawer");renderWishlist();});
  document.querySelectorAll("[data-close]").forEach(btn=>btn.addEventListener("click",closeLayers));
  $("overlay").addEventListener("click",closeLayers);
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeLayers();$("qa-panel").classList.add("hidden");}});
  $("checkout-button").addEventListener("click",()=>{if(!state.cart.length)return;openLayer("checkout-modal");$("checkout-view").classList.remove("hidden");$("order-success").classList.add("hidden");$("checkout-error").textContent="";});
  document.querySelector("[data-modal-close]").addEventListener("click",closeLayers);
  $("checkout-form").addEventListener("submit",e=>{
    e.preventDefault();$("checkout-error").textContent="";
    if(!state.cart.length){$("checkout-error").textContent="Your cart is empty.";return;}
    if(!$("checkout-form").reportValidity())return;
    const data=new FormData(e.currentTarget);
    const order={orderNumber:String(state.nextOrder++),date:new Date().toISOString(),customer:{name:String(data.get("name")).trim(),email:String(data.get("email")).trim()},items:state.cart.map(line=>({productId:line.productId,name:getProduct(line.productId).name,qty:line.qty,price:getProduct(line.productId).price})),total:subtotal()};
    /* V3 BUG INJECTION: show a successful confirmation but deliberately do not save the order. */
    state.cart=[];lastOrder=order;saveState();renderHeader();renderCart();
    $("checkout-view").classList.add("hidden");$("order-success").classList.remove("hidden");$("order-success-message").textContent=`Order #${order.orderNumber} is confirmed for ${order.customer.name}. Your demo total is ${money(order.total)}. No payment was processed.`;
  });
  $("continue-after-order").addEventListener("click",()=>{closeLayers();$("checkout-form").reset();});
  $("newsletter-form").addEventListener("submit",e=>{e.preventDefault();if(!e.currentTarget.reportValidity())return;$("newsletter-status").textContent="You're on the demo list — no email was sent.";e.currentTarget.reset();toast("Demo newsletter form submitted.");});
  $("open-qa").addEventListener("click",openQA);$("close-qa").addEventListener("click",()=>$("qa-panel").classList.add("hidden"));$("run-tests").addEventListener("click",runTests);
  $("clear-test-history").addEventListener("click",()=>{state.qaHistory=[];saveState();renderQA();toast("QA history cleared.");});
  $("reset-store").addEventListener("click",()=>{if(!window.confirm("Reset all ShopSphere V3 demo data? This clears cart, wishlist, orders, and QA history."))return;state=defaultState();saveState();renderAll();closeLayers();$("qa-panel").classList.add("hidden");$("checkout-form").reset();toast("All demo data reset.");});
  window.ShopSphereV3={getProducts:()=>products.map(p=>({...p})),getState:()=>JSON.parse(JSON.stringify(state)),runTests,reset:()=>{state=defaultState();saveState();renderAll();}};
  renderAll();
})();
