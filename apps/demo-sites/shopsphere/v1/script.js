// ShopSphere V1: the store's original, simpler design. Same catalogue, prices and order records as V2 and V3, so a
// goal written for one version means the same thing on the others. Orders are saved in this browser under the same
// key the later versions use.
(() => {
  "use strict";
  const STORAGE_KEY = "shopsphere-data";
  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

  const products = [
    { id: 1, name: "Studio Table Lamp", category: "Home", price: 68, description: "Warm light for slower evenings." },
    { id: 2, name: "Everyday Ceramic Mug", category: "Home", price: 24, description: "A handmade feel for daily rituals." },
    { id: 3, name: "Cloud Wireless Headphones", category: "Tech", price: 89, description: "Clear sound, softer edges." },
    { id: 4, name: "Botanical Hand Wash", category: "Wellness", price: 19, description: "A fresh start, morning and night." },
    { id: 5, name: "Weekend Carryall", category: "Style", price: 54, description: "Room for all the little things." },
    { id: 6, name: "Pocket Bluetooth Speaker", category: "Tech", price: 46, description: "Small size, room-filling sound." },
    { id: 7, name: "Little Leaf Planter", category: "Home", price: 32, description: "A quiet green corner, made easy." },
    { id: 8, name: "Minimal Everyday Watch", category: "Style", price: 112, description: "A considered detail for every day." },
    { id: 9, name: "Linen Notes Journal", category: "Style", price: 18, description: "Make space for a few good thoughts." },
    { id: 10, name: "Evening Ritual Candle", category: "Wellness", price: 27, description: "Soft cedar, amber, and a little calm." },
    { id: 11, name: "Desk Companion Speaker", category: "Tech", price: 74, description: "A cleaner sound for your workspace." },
    { id: 12, name: "Soft Shape Planter", category: "Home", price: 39, description: "An easy home for your favorite plant." }
  ];

  const defaultState = () => ({ cart: [], wishlist: [], orders: [], qaHistory: [], nextOrder: 1001 });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return {
        cart: [],
        wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : [],
        orders: Array.isArray(parsed.orders) ? parsed.orders.filter((order) => order && typeof order.orderNumber === "string").slice(0, 100) : [],
        qaHistory: Array.isArray(parsed.qaHistory) ? parsed.qaHistory.slice(0, 100) : [],
        nextOrder: Number.isInteger(parsed.nextOrder) ? parsed.nextOrder : 1001
      };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  let state = loadState();
  // The cart lives in memory in V1: product id to quantity.
  const cart = new Map();

  function subtotal() {
    let total = 0;
    cart.forEach((qty, id) => {
      const product = products.find((item) => item.id === id);
      if (product) total += product.price * qty;
    });
    return total;
  }

  function renderProducts(searchText = "") {
    const list = $("product-list");
    const query = searchText.trim().toLowerCase();
    const filtered = products.filter((product) => product.name.toLowerCase().includes(query));
    list.replaceChildren();

    if (filtered.length === 0) {
      const message = document.createElement("p");
      message.className = "empty-message";
      message.textContent = "No products found.";
      list.appendChild(message);
    }

    filtered.forEach((product) => {
      const card = document.createElement("article");
      card.className = "product-card";
      card.dataset.productId = String(product.id);
      card.setAttribute("aria-label", product.name);

      const tile = document.createElement("div");
      tile.className = "product-emoji";
      tile.setAttribute("aria-hidden", "true");
      tile.textContent = product.category;

      const name = document.createElement("h3");
      name.textContent = product.name;

      const description = document.createElement("p");
      description.className = "product-description";
      description.textContent = product.description;

      const price = document.createElement("p");
      price.className = "product-price";
      price.textContent = money(product.price);

      const button = document.createElement("button");
      button.className = "button primary";
      button.type = "button";
      button.textContent = "Add to Cart";
      button.dataset.testid = `add-to-cart-${product.id}`;
      button.addEventListener("click", () => addToCart(product.id));

      card.append(tile, name, description, price, button);
      list.appendChild(card);
    });

    $("search-status").textContent = `${filtered.length} product(s) found.`;
  }

  function addToCart(productId) {
    cart.set(productId, (cart.get(productId) || 0) + 1);
    renderCart();
    showOrderMessage("", false);
  }

  function renderCart() {
    const container = $("cart-items");
    container.replaceChildren();
    let itemCount = 0;

    cart.forEach((quantity, productId) => {
      const product = products.find((item) => item.id === productId);
      if (!product) return;
      itemCount += quantity;

      const row = document.createElement("div");
      row.className = "cart-row";
      row.dataset.productId = String(productId);

      const details = document.createElement("div");
      const name = document.createElement("div");
      name.className = "cart-item-name";
      name.textContent = product.name;
      const price = document.createElement("div");
      price.className = "cart-item-price";
      price.textContent = `${money(product.price)} each`;
      details.append(name, price);

      const controls = document.createElement("div");
      controls.className = "quantity-controls";

      const decrease = document.createElement("button");
      decrease.type = "button";
      decrease.textContent = "−";
      decrease.setAttribute("aria-label", `Decrease ${product.name}`);
      decrease.addEventListener("click", () => {
        const current = cart.get(productId) || 0;
        if (current <= 1) cart.delete(productId);
        else cart.set(productId, current - 1);
        renderCart();
      });

      const quantityLabel = document.createElement("span");
      quantityLabel.textContent = String(quantity);

      const increase = document.createElement("button");
      increase.type = "button";
      increase.textContent = "+";
      increase.setAttribute("aria-label", `Increase ${product.name}`);
      increase.addEventListener("click", () => {
        cart.set(productId, (cart.get(productId) || 0) + 1);
        renderCart();
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${product.name}`);
      remove.addEventListener("click", () => {
        cart.delete(productId);
        renderCart();
      });

      controls.append(decrease, quantityLabel, increase, remove);
      row.append(details, controls);
      container.appendChild(row);
    });

    if (itemCount === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-message";
      empty.textContent = "Your cart is empty.";
      container.appendChild(empty);
    }

    // Shipping is free on demo orders, as in V2: the order total is the subtotal.
    $("cart-count").textContent = String(itemCount);
    $("cart-subtotal").textContent = money(subtotal());
    $("cart-total").textContent = money(subtotal());
  }

  function showOrderMessage(message, isError) {
    const result = $("order-result");
    result.textContent = message;
    result.hidden = message === "";
    result.classList.toggle("error", isError);
  }

  $("product-search").addEventListener("input", (event) => renderProducts(event.target.value));

  $("clear-cart").addEventListener("click", () => {
    cart.clear();
    renderCart();
    showOrderMessage("", false);
  });

  $("checkout-form").addEventListener("submit", (event) => {
    event.preventDefault();

    if (cart.size === 0) {
      showOrderMessage("Please add at least one product before checkout.", true);
      return;
    }

    const name = $("customer-name").value.trim();
    const email = $("customer-email").value.trim();
    const address = $("customer-address").value.trim();

    if (name.length < 2 || !email || address.length < 5) {
      showOrderMessage("Please provide valid customer details.", true);
      return;
    }

    const order = {
      orderNumber: String(state.nextOrder++),
      date: new Date().toISOString(),
      customer: { name, email },
      items: Array.from(cart.entries()).map(([productId, qty]) => {
        const product = products.find((item) => item.id === productId);
        return { productId, name: product.name, qty, price: product.price };
      }),
      total: subtotal()
    };

    state.orders.unshift(order);
    state.orders = state.orders.slice(0, 100);
    saveState();

    showOrderMessage(`Order #${order.orderNumber} confirmed! Thank you, ${name}. Total: ${money(order.total)}. This is a demo order; no payment was taken.`, false);

    cart.clear();
    renderCart();
    $("checkout-form").reset();
  });

  renderProducts();
  renderCart();
})();
